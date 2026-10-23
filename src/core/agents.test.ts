import { test, expect, beforeEach, afterAll } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { loadAgents, resolveAgent, BUILTIN_AGENTS, parseList, parsePermMap, parseModelRef, toolsForAgent, effectivePermission, agentModelTarget } from "./agents"
import { SYSTEM_PROMPT } from "./prompt"
import type { ToolDef } from "./tools/registry"

const HOME = "/tmp/opencode/agents-home"
const PROJ = "/tmp/opencode/agents-proj"
const BUILTIN_IDS = BUILTIN_AGENTS.map(a => a.id)

function tool(name: string, permission: "allow" | "ask" = "allow"): ToolDef {
  return { name, description: name, schema: { type: "object", properties: {} }, permission, execute: async () => ({ output: "" }) }
}
const readTool = tool("read")
const editTool = tool("edit", "ask")
const writeTool = tool("write", "ask")
const shellTool = tool("shell", "ask")
const ALL_TOOLS = [readTool, editTool, writeTool, shellTool]
const KNOWN = ["read", "edit", "write", "shell"]

beforeEach(() => {
  rmSync(HOME, { recursive: true, force: true })
  rmSync(PROJ, { recursive: true, force: true })
  mkdirSync(join(HOME, ".agents", "agents"), { recursive: true })
  mkdirSync(join(PROJ, ".agents", "agents"), { recursive: true })
})
afterAll(() => { rmSync(HOME, { recursive: true, force: true }); rmSync(PROJ, { recursive: true, force: true }) })

function write(dir: string, rel: string, text: string) {
  const file = join(dir, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

/** loadAgents minus the always-present built-ins — the file-scoped assertions use this. */
function fileAgents() {
  return loadAgents(PROJ, HOME, KNOWN).filter(a => !BUILTIN_IDS.includes(a.id))
}
function byId(id: string) {
  return loadAgents(PROJ, HOME, KNOWN).find(a => a.id === id)!
}

test("loads flat and nested agents, nested path is the id", () => {
  write(join(PROJ, ".agents", "agents"), "reviewer.md", "---\ndescription: Reviews\n---\nYou review.")
  write(join(PROJ, ".agents", "agents"), "team/audit.md", "Audit things.")
  const agents = fileAgents().sort((a, b) => a.id.localeCompare(b.id))
  expect(agents.map(a => a.id)).toEqual(["reviewer", "team/audit"])
  expect(agents[0].description).toBe("Reviews")
  expect(agents[0].prompt).toBe("You review.")
})

test("project agent shadows user agent with the same id", () => {
  write(join(HOME, ".agents", "agents"), "reviewer.md", "user version")
  write(join(PROJ, ".agents", "agents"), "reviewer.md", "project version")
  expect(fileAgents().map(a => a.prompt)).toEqual(["project version"])
})

test("empty body drops the agent", () => {
  write(join(PROJ, ".agents", "agents"), "empty.md", "---\ndescription: Nothing\n---\n\n  \n")
  expect(fileAgents()).toEqual([])
})

test("unknown tool ids are dropped, agent survives", () => {
  write(join(PROJ, ".agents", "agents"), "reviewer.md",
    "---\ntools: [read, reed]\npermissions: {shell: deny, sheell: ask}\n---\nReview.")
  const a = byId("reviewer")
  expect(a.tools).toEqual(["read"])
  expect(a.permissions).toEqual({ shell: "deny" })
})

test("model is split on the first slash only", () => {
  expect(parseModelRef("9router/glm-5.2")).toEqual({ provider: "9router", model: "glm-5.2" })
  expect(parseModelRef("9router/glm/5.2")).toEqual({ provider: "9router", model: "glm/5.2" })
  expect(parseModelRef("glm-5.2")).toBeUndefined()
  expect(parseModelRef("9router/")).toBeUndefined()
  expect(parseModelRef("/glm")).toBeUndefined()
})

test("bad model warns and inherits (field absent), agent survives", () => {
  write(join(PROJ, ".agents", "agents"), "reviewer.md", "---\nmodel: glm-5.2\n---\nReview.")
  const a = byId("reviewer")
  expect(a.model).toBeUndefined()
  expect(a.prompt).toBe("Review.")
})

test("parsers tolerate quotes, brackets and spacing", () => {
  expect(parseList("[ read , \"glob\" ]")).toEqual(["read", "glob"])
  expect(parsePermMap("{shell: ask, edit:deny, bogus: maybe}")).toEqual({ shell: "ask", edit: "deny" })
})

test("toolsForAgent: no agent keeps all; list filters; deny filters", () => {
  expect(toolsForAgent([readTool, editTool]).map(t => t.name)).toEqual(["read", "edit"])
  expect(toolsForAgent([readTool, editTool], { id: "a", prompt: "p", tools: ["read"] }).map(t => t.name)).toEqual(["read"])
  expect(toolsForAgent([readTool, editTool], { id: "a", prompt: "p", permissions: { read: "deny" } }).map(t => t.name)).toEqual(["edit"])
})

test("a tools list with only unknown ids fails closed, never widens to every tool", () => {
  write(join(PROJ, ".agents", "agents"), "reviewer.md", "---\ntools: [reed]\n---\nReview.")
  expect(byId("reviewer").tools).toEqual([])
})

test("block-style tools (unparsable) fails closed and still credentials nothing", () => {
  write(join(PROJ, ".agents", "agents"), "reviewer.md", "---\ntools:\n  - read\n  - grep\n---\nReview.")
  expect(byId("reviewer").tools).toEqual([])
})

test("block-style permissions stays absent instead of becoming an empty override map", () => {
  write(join(PROJ, ".agents", "agents"), "reviewer.md", "---\npermissions:\n  shell: deny\n---\nReview.")
  expect(byId("reviewer").permissions).toBeUndefined()
})

test("agentModelTarget resolves only against a configured provider", () => {
  const agent = { id: "r", prompt: "p", model: { provider: "9router", model: "glm/5.2" } }
  expect(agentModelTarget(agent, { "9router": {} })).toEqual({ provider: "9router", model: "glm/5.2" })
  expect(agentModelTarget(agent, {})).toBeUndefined()
  expect(agentModelTarget(undefined, {})).toBeUndefined()
})

test("effectivePermission: override wins over registry default", () => {
  expect(effectivePermission(editTool)).toBe("ask")
  expect(effectivePermission(editTool, { id: "a", prompt: "p", permissions: { edit: "allow" } })).toBe("allow")
  expect(effectivePermission(readTool, { id: "a", prompt: "p", permissions: { read: "ask" } })).toBe("ask")
})

test("build and plan always load, even with no files on disk", () => {
  expect(fileAgents()).toEqual([])
  expect(loadAgents(PROJ, HOME, KNOWN).map(a => a.id).sort()).toEqual(["build", "plan"])
})

test("build reuses the base system prompt and keeps every tool", () => {
  const build = byId("build")
  expect(build.prompt).toBe(SYSTEM_PROMPT)
  expect(toolsForAgent(ALL_TOOLS, build).map(t => t.name)).toEqual(["read", "edit", "write", "shell"])
})

test("plan denies edit and write but keeps read, glob, grep, shell and skill", () => {
  const plan = byId("plan")
  expect(plan.permissions).toEqual({ edit: "deny", write: "deny" })
  expect(plan.tools).toBeUndefined()
  expect(toolsForAgent(ALL_TOOLS, plan).map(t => t.name)).toEqual(["read", "shell"])
  expect(effectivePermission(editTool, plan)).toBe("ask")   // deny removes it; it never reaches a decision
})

test("a file overrides a built-in by id; project beats user; the other built-in survives", () => {
  write(join(HOME, ".agents", "agents"), "plan.md", "user plan")
  write(join(PROJ, ".agents", "agents"), "plan.md", "---\ntools: [read]\n---\nproject plan")
  const plan = byId("plan")
  expect(plan.prompt).toBe("project plan")
  expect(plan.tools).toEqual(["read"])
  expect(byId("build").prompt).toBe(SYSTEM_PROMPT)
})

test("resolveAgent: named id, else build, even for an unknown id", () => {
  const agents = loadAgents(PROJ, HOME, KNOWN)
  expect(resolveAgent(agents, "plan")?.id).toBe("plan")
  expect(resolveAgent(agents, undefined)?.id).toBe("build")
  expect(resolveAgent(agents, "ghost")?.id).toBe("build")
  expect(resolveAgent([])?.id).toBeUndefined()
})
