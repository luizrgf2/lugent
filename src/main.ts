import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { homedir } from "node:os"
import { loadConfig, loadMcpConfig } from "./core/config"
import { Store } from "./core/store"
import { makeTools } from "./core/tools"
import type { ToolDef } from "./core/tools/registry"
import { loadSkills } from "./core/skills"
import { loadAgents } from "./core/agents"
import { McpManager } from "./core/mcp/manager"
import { Provider } from "./core/provider"
import { defaultDbPath } from "./core/platform"
import { runRepl } from "./cli/repl"

const args = process.argv.slice(2)
const dbFlag = args.indexOf("--db")
const dbPath = dbFlag !== -1 ? args[dbFlag + 1] : defaultDbPath(process.env, homedir(), process.platform)
const projectRoot = process.cwd()

mkdirSync(dirname(dbPath), { recursive: true })

const config = loadConfig(projectRoot)
const store = new Store(dbPath)
const skills = loadSkills(projectRoot)

const baseTools = makeTools(projectRoot)
const allTools: ToolDef[] = [...baseTools]
const mcp = new McpManager(loadMcpConfig(projectRoot), projectRoot)
mcp.onChange = tools => { allTools.length = 0; allTools.push(...baseTools, ...tools) }
// Register cleanup BEFORE connecting: a server that spawns and then hangs is
// mid-connect, so its child must already be reachable by closeSync.
process.on("exit", () => mcp.closeSync())
// SIGTERM/SIGHUP keep a handler for the whole process lifetime: their default
// action terminates without running exit handlers, which would orphan children.
// SIGINT only needs covering during startup — afterwards the REPL/TUI owns
// Ctrl+C and leaves through the normal exit path (which runs the handler above).
const onTerm = () => { mcp.closeSync(); process.exit(143) }
process.on("SIGTERM", onTerm)
process.on("SIGHUP", onTerm)
const onInt = () => { mcp.closeSync(); process.exit(130) }
process.on("SIGINT", onInt)
await mcp.connectAll()
process.removeListener("SIGINT", onInt)
for (const s of mcp.states()) if (s.status === "failed") console.log(`mcp: ${s.name}: ${s.error}`)

const agents = loadAgents(projectRoot, homedir(), allTools.map(t => t.name))
if (config.defaultAgent && !agents.some(a => a.id === config.defaultAgent))
  console.log(`defaultAgent "${config.defaultAgent}" not found — using the build agent`)

// startup health check: report OFF providers, never crash
const offProviders: string[] = []
for (const [name, cfg] of Object.entries(config.providers)) {
  const ok = await new Provider(cfg, "x").health()
  if (!ok) { offProviders.push(name); console.log(`${name}: OFF (${cfg.baseUrl})`) }
}

const env = { store, config, tools: allTools, skills, agents, projectRoot, mcp }
const plain = args.includes("--plain")
if (!plain && process.stdout.isTTY && process.stdin.isTTY) {
  const { runTui } = await import("./cli/tui/app")
  await runTui({ ...env, offProviders })
} else {
  await runRepl(env)
}
