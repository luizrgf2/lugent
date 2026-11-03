import { Database } from "bun:sqlite"
import { rmSync } from "node:fs"
import { test, expect, beforeEach, afterAll } from "bun:test"
import { Store, sessionPreview } from "./store"

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

test("sessionPreview: multi-line prompt collapses to single meaningful line", () => {
  const long = `Help me debug this crash\n\n\`\`\`\nconst x = 1\nconst y = 2\n\`\`\`\n\n- also check the config\n# heading\n\nThe server drops connections after exactly 30 seconds under load with many concurrent websocket clients holding open sessions and streaming payloads across regions.`
  const p = sessionPreview(long)
  expect(p.includes("\n")).toBe(false)
  expect(p.startsWith("Help me debug this crash")).toBe(true)
  expect(p.length).toBeLessThanOrEqual(96)
})

test("sessionPreview: code-only first message uses fenced content, no fence markers", () => {
  const code = "```\nconst retries = config.maxRetries ?? 3\nif (!retries) throw new Error('no retries configured')\n```"
  const p = sessionPreview(code)
  expect(p.includes("```")).toBe(false)
  expect(p.includes("\n")).toBe(false)
  expect(p.startsWith("const retries")).toBe(true)
})

test("sessionPreview: short clean prompt is kept as-is (trimmed)", () => {
  expect(sessionPreview("  fix login flow  ")).toBe("fix login flow")
})

test("listSessions: orders by last message, not creation", () => {
  const old = store.createSession("local", "qwen", "/proj/a")   // created first
  const fresh = store.createSession("local", "qwen", "/proj/a") // created later
  store.appendMessage({ id: "m-old-1", sessionId: old.id, role: "user", content: "initial task", createdAt: new Date(1).toISOString() })
  store.appendMessage({ id: "m-old-2", sessionId: old.id, role: "assistant", content: "done", createdAt: new Date(2).toISOString() })
  store.appendMessage({ id: "m-fresh-1", sessionId: fresh.id, role: "user", content: "new task", createdAt: new Date(3).toISOString() })
  // old session received a NEW message after fresh's only message
  store.appendMessage({ id: "m-old-3", sessionId: old.id, role: "user", content: "follow-up on old session", createdAt: new Date(4).toISOString() })
  const list = store.listSessions("/proj/a")
  expect(list.map(s => s.id)).toEqual([old.id, fresh.id])   // old session active last → first
})

test("listSessions: updatedAt is the max message created_at", () => {
  const s = store.createSession("local", "qwen", "/proj/a")
  store.appendMessage({ id: "m1", sessionId: s.id, role: "user", content: "one", createdAt: new Date(10).toISOString() })
  store.appendMessage({ id: "m2", sessionId: s.id, role: "assistant", content: "two", createdAt: new Date(20).toISOString() })
  const list = store.listSessions("/proj/a")
  expect(list[0].updatedAt).toBe(new Date(20).toISOString())
})

test("sessionPreview: stored preview in listSessions is single-line sanitized", () => {
  const s = store.createSession("local", "qwen", "/proj/a")
  store.appendMessage({ id: "m1", sessionId: s.id, role: "user", content: "review this\n\n- item one\n- item two\n```\ncode here\n```", createdAt: new Date().toISOString() })
  const list = store.listSessions("/proj/a")
  expect(list[0].preview.includes("\n")).toBe(false)
  expect(list[0].preview.startsWith("review this")).toBe(true)
})

test("permission grant + hasPermission", () => {
  const s = store.createSession("local", "qwen")
  expect(store.hasPermission(s.id, "shell", "bun test")).toBe(false)
  store.grantPermission(s.id, "shell", "bun test")
  expect(store.hasPermission(s.id, "shell", "bun test")).toBe(true)
  expect(store.hasPermission(s.id, "shell", "rm -rf /")).toBe(false)
})

test("createSession stores the agent and loadSession returns it", () => {
  const s = store.createSession("local", "qwen", "/proj", "reviewer")
  expect(store.loadSession(s.id)?.agent).toBe("reviewer")
})

test("sessions without an agent load as null", () => {
  const s = store.createSession("local", "qwen")
  expect(store.loadSession(s.id)?.agent).toBe(null)
})

test("setAgent switches the agent on an existing session", () => {
  const s = store.createSession("local", "qwen")
  store.setAgent(s.id, "reviewer")
  expect(store.loadSession(s.id)?.agent).toBe("reviewer")
  store.setAgent(s.id, null)
  expect(store.loadSession(s.id)?.agent).toBe(null)
})

test("reopening the database keeps the agent column (migration is idempotent)", () => {
  const s = store.createSession("local", "qwen", "/proj", "reviewer")
  store.close()
  const again = new Store(DB)
  expect(again.loadSession(s.id)?.agent).toBe("reviewer")
  again.close()
  store = new Store(DB)   // restore the shared instance for afterAll cleanup
})

test("createSession stores a parent; children() returns child rows", () => {
  const parent = store.createSession("local", "qwen", "/proj")
  const child = store.createSession("local", "qwen", "/proj", "reviewer", parent.id)
  expect(store.loadSession(child.id)?.parent).toBe(parent.id)
  expect(store.loadSession(parent.id)?.parent).toBe(null)
  expect(store.children(parent.id).map(s => s.id)).toEqual([child.id])
  expect(store.children(parent.id)[0].agent).toBe("reviewer")
})

test("listSessions hides child sessions (parent not null)", () => {
  const parent = store.createSession("local", "qwen", "/proj")
  const child = store.createSession("local", "qwen", "/proj", "reviewer", parent.id)
  store.appendMessage({ id: "mp", sessionId: parent.id, role: "user", content: "task", createdAt: new Date(1).toISOString() })
  store.appendMessage({ id: "mc", sessionId: child.id, role: "user", content: "subtask", createdAt: new Date(2).toISOString() })
  expect(store.listSessions("/proj").map(s => s.id)).toEqual([parent.id])
})

test("migrates a pre-parent database: sessions load with parent null", () => {
  store.close()
  rmSync(DB, { force: true })
  const db = new Database(DB, { create: true })
  db.run(`CREATE TABLE session (
    id TEXT PRIMARY KEY, title TEXT, created_at TEXT,
    provider TEXT, model TEXT, aborted INTEGER DEFAULT 0)`)
  db.run(`INSERT INTO session (id, created_at, provider, model) VALUES ('ses_old', '2026-01-01', 'local', 'qwen')`)
  db.close()
  const store2 = new Store(DB)
  expect(store2.loadSession("ses_old")?.parent).toBe(null)
  store2.close()
  store = new Store(DB)   // restore the shared instance for afterAll cleanup
})

test("setModel switches provider/model on an existing session", () => {
  const s = store.createSession("local", "qwen")
  store.setModel(s.id, "9router", "deepseek/deepseek-chat")
  const row = store.loadSession(s.id)
  expect(row?.provider).toBe("9router")
  expect(row?.model).toBe("deepseek/deepseek-chat")
})

test("setModel choice survives reopening the database (session remembers)", () => {
  const s = store.createSession("local", "qwen", "/proj")
  store.appendMessage({ id: "m1", sessionId: s.id, role: "user", content: "hi", createdAt: new Date(0).toISOString() })
  store.setModel(s.id, "9router", "deepseek/deepseek-chat")
  store.close()
  const again = new Store(DB)
  const row = again.loadSession(s.id)
  expect(row?.provider).toBe("9router")
  expect(row?.model).toBe("deepseek/deepseek-chat")
  const summary = again.listSessions("/proj")[0]
  expect(summary.provider).toBe("9router")
  expect(summary.model).toBe("deepseek/deepseek-chat")
  again.close()
  store = new Store(DB)   // restore the shared instance for afterAll cleanup
})
