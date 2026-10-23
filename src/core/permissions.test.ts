import { test, expect, beforeEach, afterAll } from "bun:test"
import { checkPermission, resourceFor } from "./permissions"
import { Store } from "./store"
import { rmSync } from "node:fs"

const DB = "/tmp/opencode/perm-test.db"
let store: Store
let sessionId: string
beforeEach(() => {
  rmSync(DB, { force: true })
  store = new Store(DB)
  sessionId = store.createSession("local", "qwen").id
})
afterAll(() => rmSync(DB, { force: true }))

const allowTool = { name: "read", description: "", schema: { type: "object" as const, properties: {} }, permission: "allow" as const, execute: async () => ({ output: "" }) }
const askTool = { ...allowTool, name: "shell", permission: "ask" as const }

test("allow-tool passes without asking", () => {
  expect(checkPermission(store, sessionId, allowTool, "/x")).toBe("allow")
})

test("ask-tool asks; granted always → later allow", () => {
  expect(checkPermission(store, sessionId, askTool, "bun test")).toBe("ask")
  store.grantPermission(sessionId, "shell", "bun test")
  expect(checkPermission(store, sessionId, askTool, "bun test")).toBe("allow")
  expect(checkPermission(store, sessionId, askTool, "rm -rf /")).toBe("ask") // other resource still asks
})

test("resourceFor picks path/command/id in order", () => {
  expect(resourceFor({ id: "1", name: "edit", args: { path: "a.ts" } })).toBe("a.ts")
  expect(resourceFor({ id: "1", name: "shell", args: { command: "bun test" } })).toBe("bun test")
  expect(resourceFor({ id: "1", name: "skill", args: { id: "rel" } })).toBe("rel")
  expect(resourceFor({ id: "1", name: "glob", args: {} })).toBe("*")
})

test("agent override replaces the tool default, grants still win", () => {
  const tool = { name: "edit", description: "", schema: { type: "object", properties: {} }, permission: "ask" as const, execute: async () => ({ output: "" }) }
  const agent = { id: "a", prompt: "p", permissions: { edit: "allow" as const } }
  expect(checkPermission(store, sessionId, tool, "x")).toBe("ask")
  expect(checkPermission(store, sessionId, tool, "x", agent)).toBe("allow")
  store.grantPermission(sessionId, "edit", "x")
  expect(checkPermission(store, sessionId, tool, "x", agent)).toBe("allow")
})
