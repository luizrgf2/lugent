import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { loadConfig } from "./core/config"
import { Store } from "./core/store"
import { makeTools } from "./core/tools"
import { loadSkills } from "./core/skills"
import { Provider } from "./core/provider"
import { runRepl } from "./cli/repl"

const args = process.argv.slice(2)
const dbFlag = args.indexOf("--db")
const dbPath = dbFlag !== -1 ? args[dbFlag + 1] : `${homedir()}/.local/share/lugent/db.sqlite`
const projectRoot = process.cwd()

mkdirSync(dbPath.split("/").slice(0, -1).join("/"), { recursive: true })

const config = loadConfig(projectRoot)
const store = new Store(dbPath)
const skills = loadSkills(projectRoot)
const tools = makeTools(projectRoot)

// startup health check: report OFF providers, never crash
for (const [name, cfg] of Object.entries(config.providers)) {
  const ok = await new Provider(cfg, "x").health()
  if (!ok) console.log(`${name}: OFF (${cfg.baseUrl})`)
}

await runRepl({ store, config, tools, skills, projectRoot })
