import { Database } from "bun:sqlite"
import { rmSync } from "node:fs"
import { test, expect, beforeEach, afterAll } from "bun:test"
import { Store } from "./store"

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

test("listSessions: filtered by directory, newest first, preview from first user message", () => {
  const a = store.createSession("local", "qwen", "/proj/a")
  const b = store.createSession("local", "qwen", "/proj/b")
  store.appendMessage({ id: "ma", sessionId: a.id, role: "user", content: "fix login", createdAt: new Date(1).toISOString() })
  const c = store.createSession("local", "qwen", "/proj/a")   // newer, same dir
  store.appendMessage({ id: "mc", sessionId: c.id, role: "user", content: "second task", createdAt: new Date(2).toISOString() })
  const list = store.listSessions("/proj/a")
  expect(list.map(s => s.id)).toEqual([c.id, a.id])
  expect(list[0].preview).toBe("second task")
  expect(list[1].preview).toBe("fix login")
  expect(list.some(s => s.id === b.id)).toBe(false)
})

test("listSessions: excludes empty sessions", () => {
  const s = store.createSession("local", "qwen", "/proj/a")   // no messages
  expect(store.listSessions("/proj/a")).toEqual([])
  expect(s.id).toBeTruthy()
})

test("listSessions: legacy rows without directory are excluded", () => {
  const s = store.createSession("local", "qwen")   // no directory (old call shape)
  store.appendMessage({ id: "m", sessionId: s.id, role: "user", content: "hi", createdAt: new Date().toISOString() })
  expect(store.listSessions("/proj/a")).toEqual([])
})

test("migrates existing database: directory column added, old data intact", () => {
  store.close()
  rmSync(DB, { force: true })
  const db = new Database(DB, { create: true })
  db.run(`CREATE TABLE session (
    id TEXT PRIMARY KEY, title TEXT, created_at TEXT,
    provider TEXT, model TEXT, aborted INTEGER DEFAULT 0)`)
  db.run(`INSERT INTO session (id, created_at, provider, model) VALUES ('ses_old', '2026-01-01', 'local', 'qwen')`)
  db.close()
  const store2 = new Store(DB)   // constructor must migrate
  store2.createSession("local", "qwen", "/x")
  expect(store2.listSessions("/x")).toEqual([])   // new session empty → not listed
  expect(store2.loadSession("ses_old")?.provider).toBe("local")
  store2.close()
})

test("permission grant + hasPermission", () => {
  const s = store.createSession("local", "qwen")
  expect(store.hasPermission(s.id, "shell", "bun test")).toBe(false)
  store.grantPermission(s.id, "shell", "bun test")
  expect(store.hasPermission(s.id, "shell", "bun test")).toBe(true)
  expect(store.hasPermission(s.id, "shell", "rm -rf /")).toBe(false)
})
