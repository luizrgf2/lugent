import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { Agent, AgentModelRef } from "./types"
import type { ToolDef } from "./tools/registry"
import { parseFrontmatter } from "./skills"

/** "[read, \"glob\"]" → ["read", "glob"] */
export function parseList(raw: string): string[] {
  return raw.replace(/[[\]"']/g, "").split(",").map(s => s.trim()).filter(Boolean)
}

/** "{shell: ask, edit: deny}" → { shell: "ask", edit: "deny" }; invalid effects skipped */
export function parsePermMap(raw: string): Record<string, "allow" | "ask" | "deny"> {
  const out: Record<string, "allow" | "ask" | "deny"> = {}
  for (const pair of raw.replace(/[{}]/g, "").split(",")) {
    const i = pair.indexOf(":")
    if (i <= 0) continue
    const k = pair.slice(0, i).trim()
    const v = pair.slice(i + 1).trim()
    if (k && (v === "allow" || v === "ask" || v === "deny")) out[k] = v
  }
  return out
}

/** "provider/model" — first slash splits, model may contain further slashes. */
export function parseModelRef(raw: string): AgentModelRef | undefined {
  const i = raw.indexOf("/")
  if (i <= 0 || i === raw.length - 1) return undefined
  return { provider: raw.slice(0, i), model: raw.slice(i + 1) }
}

/**
 * Loads markdown agents from `<root>/.agents/agents` plus `~/.agents/agents`.
 * Nested path is the id (`team/reviewer.md` → `team/reviewer`); project wins.
 * Bad frontmatter warns and drops only the offending entry, never the agent
 * (empty body is the exception: it drops the agent — an empty prompt is useless).
 */
export function loadAgents(projectRoot: string, homeDir: string = homedir(), knownTools: string[] = []): Agent[] {
  const merged = new Map<string, Agent>()
  for (const dir of [join(homeDir, ".agents", "agents"), join(projectRoot, ".agents", "agents")]) {
    if (!existsSync(dir)) continue
    for (const rel of new Bun.Glob("**/*.md").scanSync({ cwd: dir, onlyFiles: true })) {
      const agent = loadAgentFile(dir, rel, knownTools)
      if (agent) merged.set(agent.id, agent)
    }
  }
  return [...merged.values()]
}

function loadAgentFile(dir: string, rel: string, knownTools: string[]): Agent | undefined {
  const id = rel.replace(/\.md$/, "")
  const { data, body } = parseFrontmatter(readFileSync(join(dir, rel), "utf8"))
  const prompt = body.trim()
  if (!prompt) { console.warn(`agent ${id}: empty body, dropped`); return undefined }

  const known = (t: string) => knownTools.length === 0 || knownTools.includes(t)
  const agent: Agent = { id, prompt }
  if (data.description) agent.description = data.description

  if (data.model) {
    const ref = parseModelRef(data.model)
    if (ref) agent.model = ref
    else console.warn(`agent ${id}: bad model "${data.model}" — inheriting session model`)
  }
  if (data.tools) {
    const tools = parseList(data.tools).filter(t => {
      if (known(t)) return true
      console.warn(`agent ${id}: unknown tool "${t}" in tools, dropped`)
      return false
    })
    if (tools.length) agent.tools = tools
  }
  if (data.permissions) {
    const perms = parsePermMap(data.permissions)
    for (const name of Object.keys(perms)) {
      if (!known(name)) { console.warn(`agent ${id}: unknown tool "${name}" in permissions, dropped`); delete perms[name] }
    }
    if (Object.keys(perms).length) agent.permissions = perms
  }
  return agent
}

/** Toolset sent to the provider: agent list (when present) minus denied tools. */
export function toolsForAgent(tools: ToolDef[], agent?: Agent): ToolDef[] {
  if (!agent) return tools
  return tools.filter(t =>
    (agent.tools ? agent.tools.includes(t.name) : true) && agent.permissions?.[t.name] !== "deny")
}

/** Agent override replaces the registry default; grants/yolo stay above it (see loop). */
export function effectivePermission(tool: ToolDef, agent?: Agent): "allow" | "ask" {
  const override = agent?.permissions?.[tool.name]
  return override === "allow" || override === "ask" ? override : tool.permission
}
