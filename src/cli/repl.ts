import * as readline from "node:readline/promises"
import { readFileSync } from "node:fs"
import { runTurn } from "../core/loop"
import { Provider, discoverModels } from "../core/provider"
import { toolsForAgent, agentActivationModel, resolveAgent, primaryAgents } from "../core/agents"
import type { Store } from "../core/store"
import type { AppConfig } from "../core/config"
import { saveProvider, providerEntryInFile, globalConfigPath } from "../core/config"
import type { ToolDef } from "../core/tools/registry"
import type { McpManager } from "../core/mcp/manager"
import type { SkillMeta, Agent } from "../core/types"
import { parseSlash, parseAnswer, mcpActions, formatMcpState, type McpAction } from "./commands"
import { box, glyph, truncate, dim, cyan, red, yellow, Spinner, logo, timeAgo } from "./ui"
import { buildPromptInput } from "./context"
import { runAddProviderForm, existingProviderNames } from "./add-provider-repl"
import { readSecret, muteableOutput, isCancellation } from "./secret-prompt"

export interface ReplEnv {
  store: Store
  config: AppConfig
  tools: ToolDef[]
  skills: SkillMeta[]
  agents: Agent[]
  projectRoot: string
  mcp: McpManager
}

/**
 * Whether this directory's `lugent.json` declares providers — `loadConfig` is
 * first-file-wins, so an entry written to the global file is invisible here on
 * the next launch. The command still saves; it just says so.
 */
function projectHasProviders(projectRoot: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(`${projectRoot}/lugent.json`, "utf8"))
    const providers = raw?.providers
    return typeof providers === "object" && providers !== null && Object.keys(providers).length > 0
  } catch {
    return false
  }
}

export async function runRepl(env: ReplEnv): Promise<void> {
  // readline writes through a muteable wrapper: the one prompt that reads a
  // secret has to switch it off while it types, or readline redraws the value.
  const mute = muteableOutput(process.stdout)
  const rl = readline.createInterface({ input: process.stdin, output: mute.stream })
  // A declared model that cannot be honored kills the process at activation —
  // an agent that pins a model must run on it or not run at all.
  const activation = (a: Agent | undefined) => {
    const r = agentActivationModel(a, env.config.providers)
    if ("fatal" in r) { console.error(r.fatal); process.exit(1) }
    return r.model
  }
  let agent = resolveAgent(env.agents, env.config.defaultAgent)
  const startTarget = activation(agent)   // defaultAgent's model wins at startup
  let session = env.store.createSession(startTarget?.provider ?? env.config.defaultProvider, startTarget?.model ?? env.config.defaultModel, env.projectRoot, agent?.id ?? null)
  let model = startTarget?.model ?? env.config.defaultModel
  let providerName = startTarget?.provider ?? env.config.defaultProvider
  let providerCfg = env.config.providers[providerName]
  let abortCtrl = new AbortController()
  let sigintCount = 0
  /** Set while /mcp authenticate waits for the browser: ctrl+c cancels that, not the session. */
  let authAbort: AbortController | null = null

  rl.on("SIGINT", () => {
    if (authAbort) { authAbort.abort(); return }
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
  console.log(dim("/model /add-provider /agent /skills /mcp /clear /resume /exit · Ctrl+C aborts turn"))

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
        session = env.store.createSession(providerName, model, env.projectRoot, agent?.id ?? null)
        console.log(`new session ${session.id}`)
        continue
      }
      if (slash.cmd === "resume") {
        const list = env.store.listSessions(env.projectRoot)
        if (!list.length) { console.log("no sessions in this directory"); continue }
        list.forEach((s, i) =>
          console.log(`${i + 1}. ${s.id.slice(0, 8)} · ${s.model} · ${dim(timeAgo(s.updatedAt))} · ${truncate(s.preview, 48)}`))
        const answer = await rl.question("resume which? [1] ")
        const i = parseInt(answer.trim(), 10) - 1
        const pick = list[Number.isNaN(i) ? 0 : i]
        if (!pick) { console.log("no such session"); continue }
        const row = env.store.loadSession(pick.id)
        if (!row) { console.log("no such session"); continue }
        session = row
        agent = row.agent ? env.agents.find(a => a.id === row.agent) : undefined
        const target = activation(agent)
        if (target) { providerCfg = env.config.providers[target.provider]; providerName = target.provider; model = target.model }
        else {
          // the session remembers its last provider/model — restore both, not just the model
          if (row.provider && env.config.providers[row.provider]) { providerCfg = env.config.providers[row.provider]; providerName = row.provider }
          else if (row.provider) { providerName = row.provider; providerCfg = undefined }
          if (row.model) model = row.model
        }
        console.log(`resumed ${row.id} (${env.store.getMessages(row.id).length} messages)${agent ? ` · agent ${agent.id}` : ""}`)
        continue
      }
      if (slash.cmd === "skills") {
        console.log(env.skills.map(s => `- ${s.id}: ${s.description}`).join("\n") || "(none)")
        continue
      }
      if (slash.cmd === "mcp") {
        const [action, name] = slash.args
        const USAGE = "usage: /mcp [auth|logout|reconnect|disable|enable] <name>"
        if (!action) {
          const list = env.mcp.states()
          console.log(list.map(formatMcpState).join("\n") || "(no MCP servers configured)")
          continue
        }
        const WANTED: Record<string, McpAction> = {
          auth: "authenticate", authenticate: "authenticate",
          logout: "logout", reconnect: "reconnect", disable: "disable", enable: "enable",
        }
        const wants = WANTED[action]
        if (!name || !wants) { console.log(USAGE); continue }
        const before = env.mcp.states().find(s => s.name === name)
        if (!before) { console.log(`unknown MCP server "${name}" — /mcp lists them`); continue }
        if (!mcpActions(before.status, before.type).includes(wants)) {
          console.log(`cannot ${action} ${name} (${before.status})`)
          continue
        }
        if (wants === "authenticate") {
          authAbort = new AbortController()
          try {
            console.log(`waiting for ${name} authorization in your browser… (ctrl+c cancels)`)
            await env.mcp.authenticate(name, {
              onUrl: url => console.log(`if the browser did not open, visit:\n${url}`),
              signal: authAbort.signal,
            })
          } catch (e) {
            console.log(`authenticate failed: ${(e as Error).message}`)
          } finally {
            authAbort = null
          }
        } else if (wants === "logout") await env.mcp.logout(name)
        else if (wants === "reconnect") await env.mcp.reconnect(name)
        else if (wants === "disable") await env.mcp.disable(name)
        else await env.mcp.enable(name)
        const after = env.mcp.states().find(s => s.name === name)!
        console.log(`mcp ${name}: ${after.status}${after.error ? ` — ${after.error}` : ""}`)
        continue
      }
      if (slash.cmd === "agent") {
        const [id] = slash.args
        if (!id) {
          console.log(primaryAgents(env.agents).map(a => `- ${a.id}${a.description ? `: ${a.description}` : ""}`).join("\n") || "(none)")
          continue
        }
        const found = primaryAgents(env.agents).find(a => a.id === id)
        if (!found) { console.log(`unknown agent "${id}" — /agent lists them`); continue }
        agent = found
        env.store.setAgent(session.id, found.id)
        const target = activation(found)
        if (target) { providerCfg = env.config.providers[target.provider]; providerName = target.provider; model = target.model }
        console.log(`agent ${found.id}${target ? ` · ${target.provider}/${target.model}` : ""} · tools: ${toolsForAgent(env.tools, found).map(t => t.name).join(",") || "none"}`)
        continue
      }
      if (slash.cmd === "model") {
        const [provName, modelName] = slash.args
        if (!provName) {
          if (providerCfg) {
            // A cached list is authoritative: no endpoint call needed.
            if (providerCfg.models?.length) { console.log(providerCfg.models.join("\n")); continue }
            try { console.log((await new Provider(providerCfg, model).listModels()).join("\n") || "(no models)") }
            catch (e: any) { console.log(`list failed: ${e.message}`) }
          } else console.log("no provider configured (lugent.json)")
          continue
        }
        if (env.config.providers[provName]) {
          providerCfg = env.config.providers[provName]
          providerName = provName
          if (modelName) model = modelName
          // The session remembers the picked model: /resume restores it later.
          env.store.setModel(session.id, providerName, model)
          console.log(`provider ${provName} model ${model}`)
        } else {
          console.log("usage: /model <provider> [model]")
        }
        continue
      }
      if (slash.cmd === "add-provider") {
        const USAGE = "usage: /add-provider <name> — interactive: asks base url and api key, tests the endpoint, asks which models to import"
        // A piped (non-TTY) session has no one to answer the prompts: printing
        // usage and returning beats hanging on rl.question forever.
        if (!process.stdin.isTTY) { console.log(USAGE); continue }
        // The flow itself (validation, the Test, the overwrite gate) lives in
        // `add-provider-repl.ts` so it can be tested without a terminal; this
        // branch is only the wiring: readline for questions, console for lines.
        //
        // The `try` is not defensive noise: Ctrl+C at the masked key prompt
        // rejects, and an uncaught rejection here ended the whole session with a
        // Bun stack and exit 1. The form turns cancellations into a `cancelled`
        // result; anything else that escapes must still not kill the REPL.
        let r: Awaited<ReturnType<typeof runAddProviderForm>>
        try {
          r = await runAddProviderForm({
            name: slash.args[0],
            ask: q => rl.question(q),
            // The key is masked: readline echoes as you type, and a secret must not
            // stay in the terminal's scrollback. `rl` is paused so the two readers
            // never split one keystroke between them.
            askSecret: async q => {
              rl.pause()
              // readline keeps redrawing its line buffer while paused; mute the
              // stream it writes into for the duration, or it prints the key it is
              // not reading.
              const unmute = mute.mute()
              try {
                return await readSecret({
                  prompt: q, input: process.stdin,
                  output: mute.stream, promptOutput: process.stdout,
                })
              } finally {
                unmute()
                rl.resume()
              }
            },
            say: line => console.log(line),
            onTest: url => console.log(dim(`testing ${url}/models…`)),
            discover: discoverModels,
            // A name already in the config means this save REPLACES that entry —
            // the form asks before destroying a working base url and key, exactly
            // as the TUI's confirm does (spec §"Validation, cheaply").
            existing: existingProviderNames(Object.keys(env.config.providers), globalConfigPath()),
            // A blank key field keeps the stored key on write; the Test has to send
            // that same key, or a re-run against an auth-enforcing endpoint 401s.
            storedEntry: n => providerEntryInFile(n, globalConfigPath()),
            save: (n, cfg) => saveProvider(n, cfg, globalConfigPath()),
          })
        } catch (e: any) {
          if (!isCancellation(e)) console.log(red(`add-provider failed: ${e?.message ?? e}`))
          else console.log("cancelled — nothing written")
          rl.resume()
          continue
        }
        if (r.status === "invalid") { console.log(red(r.error)); continue }
        if (r.status === "cancelled") { console.log("cancelled — nothing written"); continue }
        if (!r.saveOk) console.log(red(`save failed, session only: ${r.saveError}`))
        // The entry `saveProvider` built for the session: key resolved through
        // `subEnv()` (Provider sends it verbatim — a raw `{env:VAR}` here is a
        // literal `Bearer {env:VAR}` and a 401 until restart), empty key field
        // resolved to the stored one, `models` as written.
        env.config.providers[r.name] = r.live
        const shadow = projectHasProviders(env.projectRoot) ? yellow(" — shadowed by this directory's lugent.json") : ""
        // `models` is omitted on a models-less save, and `saveProvider` then
        // KEEPS whatever the file already had — so report that list as kept,
        // never as imported.
        const summary = r.imported
          ? `${r.imported} models`
          : r.kept ? `saved, ${r.kept} cached models kept (the endpoint advertised none)` : "no model list"
        console.log(`saved ${r.name} · ${summary}${shadow}`)
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
      agents: env.agents,
      config: env.config,
      providerFor: (p, m) => new Provider(env.config.providers[p], m),
      onToken: t => { clearSpin(); process.stdout.write(t) },
      onRetry: i => { clearSpin(); process.stdout.write(yellow(`attempt ${i.attempt} failed — ${i.error} · retrying in ${Math.round(i.delayMs / 1000)}s\n`)) },
      onToolStart: (name, resource) => {
        clearSpin()
        process.stdout.write(`\n${glyph(name)} ${dim(name)} ${cyan(truncate(resource, 64))}\n`)
      },
      // Plain REPL: no live view — one dim line when a child starts and when it ends.
      onSubagentStart: (sid, aid) => { clearSpin(); process.stdout.write(`${dim(`↳ subagent ${aid} (${sid.slice(0, 8)}…) started`)}\n`) },
      onSubagentEnd: sid => { clearSpin(); process.stdout.write(`${dim(`↳ subagent (${sid.slice(0, 8)}…) finished`)}\n`) },
      // Spawn-side fatals must not kill the session: render and continue (issue #27).
      onFatal: m => { clearSpin(); console.log(red(m)) },
      onAsk: async (tool, resource) => { clearSpin(); return ask(tool, resource) },
    }, session.id, input, env.projectRoot)
      .catch((e: any) => ({ aborted: false, error: `internal error: ${e?.message ?? e}` }))
    clearSpin()
    if (r.error) console.log(red(`error: ${r.error}`))
    process.stdout.write("\n")
  }
  rl.close()
}
