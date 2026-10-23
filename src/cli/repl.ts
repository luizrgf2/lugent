import * as readline from "node:readline/promises"
import { readFileSync } from "node:fs"
import { runTurn } from "../core/loop"
import { Provider } from "../core/provider"
import { buildPrefix, type PromptInput } from "../core/prompt"
import type { Store } from "../core/store"
import type { AppConfig } from "../core/config"
import type { ToolDef } from "../core/tools/registry"
import type { SkillMeta } from "../core/types"
import { parseSlash, parseAnswer } from "./commands"

export interface ReplEnv {
  store: Store
  config: AppConfig
  tools: ToolDef[]
  skills: SkillMeta[]
  projectRoot: string
}

function safeBranch(root: string): string | null {
  try {
    return readFileSync(`${root}/.git/HEAD`, "utf8").replace("ref: refs/heads/", "").trim()
  } catch { return null }
}

function safeAgentsMd(root: string): string | null {
  try { return readFileSync(`${root}/AGENTS.md`, "utf8") } catch { return null }
}

export async function runRepl(env: ReplEnv): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  let session = env.store.createSession(env.config.defaultProvider, env.config.defaultModel)
  let model = env.config.defaultModel
  let providerCfg = env.config.providers[env.config.defaultProvider]
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

  console.log(`session ${session.id} | /model /skills /clear /exit | Ctrl+C aborts turn`)

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
        session = env.store.createSession(env.config.defaultProvider, model)
        console.log(`new session ${session.id}`)
        continue
      }
      if (slash.cmd === "skills") {
        console.log(env.skills.map(s => `- ${s.id}: ${s.description}`).join("\n") || "(none)")
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
    const promptInput: PromptInput = {
      cwd: env.projectRoot,
      os: process.platform,
      gitBranch: safeBranch(env.projectRoot),
      date: new Date().toISOString().slice(0, 10),
      agentsMd: safeAgentsMd(env.projectRoot),
      skills: env.skills,
      tools: env.tools.map(t => ({ name: t.name, description: t.description, schema: t.schema })),
    }
    const r = await runTurn({
      store: env.store, provider, tools: env.tools, promptInput,
      signal: abortCtrl.signal,
      onToken: t => process.stdout.write(t),
      onToolStart: (name, resource) => process.stdout.write(`\n⚙ ${name} ${resource}\n`),
      onAsk: ask,
    }, session.id, input)
    if (r.error) console.log(`error: ${r.error}`)
    process.stdout.write("\n")
  }
  rl.close()
}
