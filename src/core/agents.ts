import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { Agent, AgentModelRef } from "./types"
import type { ToolDef } from "./tools/registry"
import { parseFrontmatter } from "./skills"
import { SYSTEM_PROMPT } from "./prompt"

const PLAN_PROMPT = `You are lugent in plan mode: you explore and design, you do not change files.

Read the code and the tests before proposing anything. Answer with a concrete plan:
the files to touch, the change in each, how to verify it, and the risks.

You cannot edit or write files — those tools are withheld from you. When work is
needed, state exactly what to change and let the user switch to the build agent
to apply it.`

/**
 * Agents every install has (OpenCode's `build` / `plan` pair, adapted: no rule
 * engine and no plan files). They load first, so a file with the same id — user
 * or project scope — overrides one without removing it.
 */
export const BUILTIN_AGENTS: Agent[] = [
  {
    id: "build",
    description: "Implements changes (default)",
    prompt: SYSTEM_PROMPT,   // the base prompt itself: the default path stays byte-identical
  },
  {
    id: "plan",
    description: "Plans changes read-only — no edit or write",
    permissions: { edit: "deny", write: "deny" },
    prompt: PLAN_PROMPT,
  },
]

/** The session's agent: the requested id when it exists, else `build`. Undefined only if build is gone. */
export function resolveAgent(agents: Agent[], id?: string): Agent | undefined {
  return (id ? agents.find(a => a.id === id) : undefined) ?? agents.find(a => a.id === "build")
}

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
 * Loads markdown agents from `<root>/.agents/agents` plus `~/.agents/agents`,
 * on top of the always-present built-ins (`build`, `plan`). Nested path is the
 * id (`team/reviewer.md` → `team/reviewer`); later scopes win, so a file
 * overrides a built-in and project beats user.
 * Bad frontmatter warns and drops only the offending entry, never the agent
 * (empty body is the exception: it drops the agent — an empty prompt is useless).
 */
export function loadAgents(projectRoot: string, homeDir: string = homedir(), knownTools: string[] = []): Agent[] {
  const merged = new Map<string, Agent>(BUILTIN_AGENTS.map(a => [a.id, a]))
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
  if (data.tools !== undefined) {
    if (data.tools.trim() === "")
      console.warn(`agent ${id}: "tools" needs a one-line list (e.g. [read, grep]) — denying every tool`)
    const tools = parseList(data.tools).filter(t => {
      if (known(t)) return true
      console.warn(`agent ${id}: unknown tool "${t}" in tools, dropped`)
      return false
    })
    agent.tools = tools   // present key ⇒ fail closed: a typo must not widen access to every tool
  }
  if (data.permissions !== undefined) {
    if (data.permissions.trim() === "")
      console.warn(`agent ${id}: "permissions" needs one-line pairs (e.g. {shell: ask})`)
    const perms = parsePermMap(data.permissions)
    for (const name of Object.keys(perms)) {
      if (!known(name)) { console.warn(`agent ${id}: unknown tool "${name}" in permissions, dropped`); delete perms[name] }
    }
    if (Object.keys(perms).length) agent.permissions = perms
  }
  return agent
}

/** The agent's model when its provider is configured; undefined means "inherit the session's". */
export function agentModelTarget(agent: Agent | undefined, providers: Record<string, unknown>): AgentModelRef | undefined {
  return agent?.model && providers[agent.model.provider] ? agent.model : undefined
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
