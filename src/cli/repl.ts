import * as readline from "node:readline/promises"
import { runTurn } from "../core/loop"
import { Provider } from "../core/provider"
import { toolsForAgent, agentModelTarget, resolveAgent } from "../core/agents"
import type { Store } from "../core/store"
import type { AppConfig } from "../core/config"
import type { ToolDef } from "../core/tools/registry"
import type { SkillMeta, Agent } from "../core/types"
import { parseSlash, parseAnswer } from "./commands"
import { box, glyph, truncate, dim, cyan, red, Spinner, logo } from "./ui"
import { buildPromptInput } from "./context"

export interface ReplEnv {
  store: Store
  config: AppConfig
  tools: ToolDef[]
  skills: SkillMeta[]
  agents: Agent[]
  projectRoot: string
}

export async function runRepl(env: ReplEnv): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  let agent = resolveAgent(env.agents, env.config.defaultAgent)
  const startTarget = agentModelTarget(agent, env.config.providers)   // defaultAgent's model wins at startup
  let session = env.store.createSession(startTarget?.provider ?? env.config.defaultProvider, startTarget?.model ?? env.config.defaultModel, env.projectRoot, agent?.id ?? null)
  let model = startTarget?.model ?? env.config.defaultModel
  let providerName = startTarget?.provider ?? env.config.defaultProvider
  let providerCfg = env.config.providers[providerName]
  let abortCtrl = new AbortController()
  let sigintCount = 0

  rl.on("SIGINT", () => {
    sigintCount++
    if (sigintCount === 1) { abortCtrl.abort(); process.stdout.write("\n(aborted)\n") }
    else process.exit(0)
  })

  const ask = async (tool: string, resource: string): Promise<"y" | "n" | "a"> => {
    const answer = await rl.question(`\n allow ${tool} on "${resource}"? [y/n/a(lways)] `)
    return parseAnswer(answer)
  }

  console.log(logo())
  console.log(box("lugent", [
    `session ${session.id.slice(0, 8)}…`,
    `${providerName} · ${model}`,
  ]))
  console.log(dim("/model /agent /skills /clear /resume /exit · Ctrl+C aborts turn"))

  while (true) {
    let input: string
    try {
      input = (await rl.question("> ")).trim()
    } catch {
      break   // stdin closed (EOF/Ctrl+D): exit cleanly
    }
    if (!input) continue
    sigintCount = 0

    const slash = parseSlash(input)
    if (slash) {
      if (slash.cmd === "exit") break
      if (slash.cmd === "clear") {
        session = env.store.createSession(env.config.defaultProvider, model, env.projectRoot, agent?.id ?? null)
        console.log(`new session ${session.id}`)
        continue
      }
      if (slash.cmd === "resume") {
        const list = env.store.listSessions(env.projectRoot)
        if (!list.length) { console.log("no sessions in this directory"); continue }
        list.forEach((s, i) =>
          console.log(`${i + 1}. ${s.id.slice(0, 8)} · ${s.model} · ${truncate(s.preview, 48)}`))
        const answer = await rl.question("resume which? [1] ")
        const i = parseInt(answer.trim(), 10) - 1
        const pick = list[Number.isNaN(i) ? 0 : i]
        if (!pick) { console.log("no such session"); continue }
        const row = env.store.loadSession(pick.id)
        if (!row) { console.log("no such session"); continue }
        session = row
        agent = row.agent ? env.agents.find(a => a.id === row.agent) : undefined
        const target = agentModelTarget(agent, env.config.providers)
        if (target) { providerCfg = env.config.providers[target.provider]; providerName = target.provider; model = target.model }
        else if (row.model) model = row.model
        console.log(`resumed ${row.id} (${env.store.getMessages(row.id).length} messages)${agent ? ` · agent ${agent.id}` : ""}`)
        continue
      }
      if (slash.cmd === "skills") {
        console.log(env.skills.map(s => `- ${s.id}: ${s.description}`).join("\n") || "(none)")
        continue
      }
      if (slash.cmd === "agent") {
        const [id] = slash.args
        if (!id) {
          console.log(env.agents.map(a => `- ${a.id}${a.description ? `: ${a.description}` : ""}`).join("\n") || "(none)")
          continue
        }
        const found = env.agents.find(a => a.id === id)
        if (!found) { console.log(`unknown agent "${id}" — /agent lists them`); continue }
        agent = found
        env.store.setAgent(session.id, found.id)
        const target = agentModelTarget(found, env.config.providers)
        if (target) { providerCfg = env.config.providers[target.provider]; providerName = target.provider; model = target.model }
        console.log(`agent ${found.id}${target ? ` · ${target.provider}/${target.model}` : ""} · tools: ${toolsForAgent(env.tools, found).map(t => t.name).join(",") || "none"}`)
        continue
      }
      if (slash.cmd === "model") {
        const [provName, modelName] = slash.args
        if (!provName) {
          if (providerCfg) {
            try { console.log((await new Provider(providerCfg, model).listModels()).join("\n") || "(no models)") }
            catch (e: any) { console.log(`list failed: ${e.message}`) }
          } else console.log("no provider configured (lugent.json)")
          continue
        }
        if (env.config.providers[provName]) {
          providerCfg = env.config.providers[provName]
          providerName = provName
          if (modelName) model = modelName
          console.log(`provider ${provName} model ${model}`)
        } else {
          console.log("usage: /model <provider> [model]")
        }
        continue
      }
      console.log("unknown command")
      continue
    }

    if (!providerCfg) { console.log("no provider configured (lugent.json)"); continue }

    abortCtrl = new AbortController()
    const provider = new Provider(providerCfg, model)
    const spin = new Spinner("thinking…").start()
    const clearSpin = () => spin.stop("")
    const promptInput = buildPromptInput(env, model, agent)
    const r = await runTurn({
      store: env.store, provider, tools: env.tools, promptInput,
      signal: abortCtrl.signal,
      onToken: t => { clearSpin(); process.stdout.write(t) },
      onToolStart: (name, resource) => {
        clearSpin()
        process.stdout.write(`\n${glyph(name)} ${dim(name)} ${cyan(truncate(resource, 64))}\n`)
      },
      onAsk: async (tool, resource) => { clearSpin(); return ask(tool, resource) },
    }, session.id, input, env.projectRoot)
    clearSpin()
    if (r.error) console.log(red(`error: ${r.error}`))
    process.stdout.write("\n")
  }
  rl.close()
}
