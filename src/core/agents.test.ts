import { test, expect, beforeEach, afterAll } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { loadAgents, parseList, parsePermMap, parseModelRef, toolsForAgent, effectivePermission, agentModelTarget } from "./agents"
import type { ToolDef } from "./tools/registry"

const HOME = "/tmp/opencode/agents-home"
const PROJ = "/tmp/opencode/agents-proj"

const readTool: ToolDef = {
  name: "read", description: "read", schema: { type: "object", properties: {} },
  permission: "allow", execute: async () => ({ output: "" }),
}
const editTool: ToolDef = {
  name: "edit", description: "edit", schema: { type: "object", properties: {} },
  permission: "ask", execute: async () => ({ output: "" }),
}
const KNOWN = ["read", "edit", "shell"]

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

test("loads flat and nested agents, nested path is the id", () => {
  write(join(PROJ, ".agents", "agents"), "reviewer.md", "---\ndescription: Reviews\n---\nYou review.")
  write(join(PROJ, ".agents", "agents"), "team/audit.md", "Audit things.")
  const agents = loadAgents(PROJ, HOME, KNOWN).sort((a, b) => a.id.localeCompare(b.id))
  expect(agents.map(a => a.id)).toEqual(["reviewer", "team/audit"])
  expect(agents[0].description).toBe("Reviews")
  expect(agents[0].prompt).toBe("You review.")
})

test("project agent shadows user agent with the same id", () => {
  write(join(HOME, ".agents", "agents"), "reviewer.md", "user version")
  write(join(PROJ, ".agents", "agents"), "reviewer.md", "project version")
  const agents = loadAgents(PROJ, HOME, KNOWN)
  expect(agents.length).toBe(1)
  expect(agents[0].prompt).toBe("project version")
})

test("empty body drops the agent", () => {
  write(join(PROJ, ".agents", "agents"), "empty.md", "---\ndescription: Nothing\n---\n\n  \n")
  expect(loadAgents(PROJ, HOME, KNOWN)).toEqual([])
})

test("unknown tool ids are dropped, agent survives", () => {
  write(join(PROJ, ".agents", "agents"), "reviewer.md",
    "---\ntools: [read, reed]\npermissions: {shell: deny, sheell: ask}\n---\nReview.")
  const a = loadAgents(PROJ, HOME, KNOWN)[0]
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
  const a = loadAgents(PROJ, HOME, KNOWN)[0]
  expect(a.model).toBeUndefined()
  expect(a.prompt).toBe("Review.")
})

test("parsers tolerate quotes, brackets and spacing", () => {
  expect(parseList("[ read , \"glob\" ]")).toEqual(["read", "glob"])
  expect(parsePermMap("{shell: ask, edit:deny, bogus: maybe}")).toEqual({ shell: "ask", edit: "deny" })
})

test("toolsForAgent: no agent keeps all; list filters; deny filters", () => {
  const all = [readTool, editTool]
  expect(toolsForAgent(all).map(t => t.name)).toEqual(["read", "edit"])
  expect(toolsForAgent(all, { id: "a", prompt: "p", tools: ["read"] }).map(t => t.name)).toEqual(["read"])
  expect(toolsForAgent(all, { id: "a", prompt: "p", permissions: { read: "deny" } }).map(t => t.name)).toEqual(["edit"])
})

test("a tools list with only unknown ids fails closed, never widens to every tool", () => {
  write(join(PROJ, ".agents", "agents"), "reviewer.md", "---\ntools: [reed]\n---\nReview.")
  expect(loadAgents(PROJ, HOME, KNOWN)[0].tools).toEqual([])
})

test("block-style tools (unparsable) fails closed and still credentials nothing", () => {
  write(join(PROJ, ".agents", "agents"), "reviewer.md", "---\ntools:\n  - read\n  - grep\n---\nReview.")
  expect(loadAgents(PROJ, HOME, KNOWN)[0].tools).toEqual([])
})

test("block-style permissions stays absent instead of becoming an empty override map", () => {
  write(join(PROJ, ".agents", "agents"), "reviewer.md", "---\npermissions:\n  shell: deny\n---\nReview.")
  expect(loadAgents(PROJ, HOME, KNOWN)[0].permissions).toBeUndefined()
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
