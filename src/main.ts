import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { homedir } from "node:os"
import { loadConfig } from "./core/config"
import { Store } from "./core/store"
import { makeTools } from "./core/tools"
import { loadSkills } from "./core/skills"
import { loadAgents } from "./core/agents"
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
const tools = makeTools(projectRoot)
const agents = loadAgents(projectRoot, homedir(), tools.map(t => t.name))
if (config.defaultAgent && !agents.some(a => a.id === config.defaultAgent))
  console.log(`defaultAgent "${config.defaultAgent}" not found — using the base agent`)

// startup health check: report OFF providers, never crash
const offProviders: string[] = []
for (const [name, cfg] of Object.entries(config.providers)) {
  const ok = await new Provider(cfg, "x").health()
  if (!ok) { offProviders.push(name); console.log(`${name}: OFF (${cfg.baseUrl})`) }
}

const env = { store, config, tools, skills, agents, projectRoot }
const plain = args.includes("--plain")
if (!plain && process.stdout.isTTY && process.stdin.isTTY) {
  const { runTui } = await import("./cli/tui/app")
  await runTui({ ...env, offProviders })
} else {
  await runRepl(env)
}
