import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { Store } from "./store"
import { rmSync } from "node:fs"

const DB = "/tmp/opencode/lugent-test.db"
let store: Store

beforeEach(() => { rmSync(DB, { force: true }); store = new Store(DB) })
afterAll(() => rmSync(DB, { force: true }))

test("session create/load roundtrip", () => {
  const s = store.createSession("local", "qwen")
  const loaded = store.loadSession(s.id)
  expect(loaded?.provider).toBe("local")
  expect(loaded?.model).toBe("qwen")
  expect(loaded?.aborted).toBe(false)
})

test("append/load messages in order, all roles", () => {
  const s = store.createSession("local", "qwen")
  const mk = (role: any, n: number, extra: any = {}) => ({
    id: `m${n}`, sessionId: s.id, role, content: `c${n}`, createdAt: new Date(n).toISOString(), ...extra,
  })
  store.appendMessage(mk("user", 1))
  store.appendMessage({ ...mk("assistant", 2), toolCalls: [{ id: "tc1", name: "read", args: { path: "x" } }] })
  store.appendMessage({ ...mk("tool", 3), toolCallId: "tc1" })
  const msgs = store.getMessages(s.id)
  expect(msgs.map(m => m.role)).toEqual(["user", "assistant", "tool"])
  expect(msgs[1].toolCalls).toEqual([{ id: "tc1", name: "read", args: { path: "x" } }])
  expect(msgs[2].toolCallId).toBe("tc1")
})

test("abort flags session without touching messages", () => {
  const s = store.createSession("local", "qwen")
  store.appendMessage({ id: "m1", sessionId: s.id, role: "user", content: "hi", createdAt: new Date().toISOString() })
  store.setAborted(s.id)
  expect(store.loadSession(s.id)?.aborted).toBe(true)
  expect(store.getMessages(s.id).length).toBe(1)
})

test("permission grant + hasPermission", () => {
  const s = store.createSession("local", "qwen")
  expect(store.hasPermission(s.id, "shell", "bun test")).toBe(false)
  store.grantPermission(s.id, "shell", "bun test")
  expect(store.hasPermission(s.id, "shell", "bun test")).toBe(true)
  expect(store.hasPermission(s.id, "shell", "rm -rf /")).toBe(false)
})
