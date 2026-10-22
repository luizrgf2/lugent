import { test, expect, beforeEach, afterAll } from "bun:test"
import { runTurn, type LoopDeps } from "./loop"
import { Store } from "./store"
import { rmSync, mkdirSync, writeFileSync } from "node:fs"
import type { ChatResponse } from "./types"
import type { ToolDef } from "./tools/registry"

const DIR = "/tmp/opencode/loop"
const DB = "/tmp/opencode/loop.db"
let store: Store
let sessionId: string
let tools: ToolDef[]

const echoTool: ToolDef = {
  name: "echo", description: "echo", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  permission: "allow", execute: async (a) => ({ output: `echoed:${a.path}` }),
}
const boomTool: ToolDef = {
  name: "boom", description: "boom", schema: { type: "object", properties: {} },
  permission: "allow", execute: async () => { throw new Error("kaboom") },
}

beforeEach(() => {
  rmSync(DB, { force: true })
  mkdirSync(DIR, { recursive: true })
  writeFileSync(`${DIR}/a.txt`, "content\n")
  store = new Store(DB)
  sessionId = store.createSession("local", "qwen").id
  tools = [echoTool, boomTool]
})
afterAll(() => { rmSync(DB, { force: true }); rmSync(DIR, { recursive: true, force: true }) })

const promptInput = {
  cwd: DIR, os: "linux", gitBranch: null, date: "2026-10-22",
  agentsMd: null, skills: [], tools: [],
}

function deps(provider: any, over: Partial<LoopDeps> = {}): LoopDeps {
  return {
    store, provider, tools, promptInput,
    signal: new AbortController().signal,
    onAsk: async () => "y" as const,
    ...over,
  }
}

test("loop terminates on plain text and stores the turn", async () => {
  const provider = { chat: async () => ({ content: "all done", toolCalls: [] }) }
  const r = await runTurn(deps(provider), sessionId, "hello")
  expect(r.aborted).toBe(false)
  const msgs = store.getMessages(sessionId)
  expect(msgs.map(m => m.role)).toEqual(["user", "assistant"])
  expect(msgs[1].content).toBe("all done")
})

test("loop executes tool, feeds result, then finishes (parallel N)", async () => {
  const calls: any[] = []
  let step = 0
  const provider = {
    chat: async (a: any) => {
      calls.push(a.messages)
      step++
      if (step === 1) return {
        content: "",
        toolCalls: [
          { id: "t1", name: "echo", args: { path: "a" } },
          { id: "t2", name: "echo", args: { path: "b" } },
        ],
      }
      return { content: "finished", toolCalls: [] }
    },
  }
  const r = await runTurn(deps(provider), sessionId, "go")
  expect(r.aborted).toBe(false)
  const second = calls[1]
  const toolMsgs = second.filter((m: any) => m.role === "tool")
  expect(toolMsgs.length).toBe(2)                       // both results before next request
  expect(toolMsgs.map((m: any) => m.content).sort()).toEqual(["echoed:a", "echoed:b"])
})

test("malformed tool args become schema-error result, loop continues (golden #4)", async () => {
  let step = 0
  const provider = {
    chat: async () => {
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "echo", args: "{broken" }] }
      return { content: "recovered", toolCalls: [] }
    },
  }
  await runTurn(deps(provider), sessionId, "go")
  const msgs = store.getMessages(sessionId)
  const toolMsg = msgs.find(m => m.role === "tool")!
  expect(toolMsg.content).toContain("args must be an object")
})

test("tool throw becomes error result, loop continues", async () => {
  let step = 0
  const provider = {
    chat: async () => {
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "boom", args: {} }] }
      return { content: "survived", toolCalls: [] }
    },
  }
  await runTurn(deps(provider), sessionId, "go")
  const toolMsg = store.getMessages(sessionId).find(m => m.role === "tool")!
  expect(toolMsg.content).toContain("kaboom")
})

test("unknown tool name becomes error result", async () => {
  let step = 0
  const provider = {
    chat: async () => {
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "nope", args: {} }] }
      return { content: "ok", toolCalls: [] }
    },
  }
  await runTurn(deps(provider), sessionId, "go")
  expect(store.getMessages(sessionId).find(m => m.role === "tool")!.content).toContain("unknown tool")
})

test("deny on ask stores permission denied and continues", async () => {
  const askTool: ToolDef = { ...echoTool, name: "asktool", permission: "ask" }
  tools = [askTool]
  let step = 0
  const provider = {
    chat: async () => {
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "asktool", args: { path: "x" } }] }
      return { content: "ok", toolCalls: [] }
    },
  }
  await runTurn(deps(provider, { onAsk: async () => "n" }), sessionId, "go")
  expect(store.getMessages(sessionId).find(m => m.role === "tool")!.content).toContain("permission denied")
})

test("always on ask grants session permission", async () => {
  const askTool: ToolDef = { ...echoTool, name: "asktool", permission: "ask" }
  tools = [askTool]
  let step = 0
  const provider = {
    chat: async () => {
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "asktool", args: { path: "x" } }] }
      return { content: "ok", toolCalls: [] }
    },
  }
  await runTurn(deps(provider, { onAsk: async () => "a" }), sessionId, "go")
  expect(store.hasPermission(sessionId, "asktool", "x")).toBe(true)
})

test("abort before tools: no orphan tool_calls (golden #2)", async () => {
  const ac = new AbortController()
  let step = 0
  const provider = {
    chat: async (a: any) => {
      step++
      if (step === 1) {
        ac.abort()                                      // abort lands right after the request
        return { content: "", toolCalls: [{ id: "t1", name: "echo", args: { path: "a" } }] }
      }
      throw new Error("should not be called")
    },
  }
  const r = await runTurn(deps(provider, { signal: ac.signal }), sessionId, "go")
  expect(r.aborted).toBe(true)
  expect(store.loadSession(sessionId)!.aborted).toBe(true)
  expect(step).toBe(1)                                  // tools never executed, no second request

  // next turn still works: cleanHistory drops the unanswered assistant calls
  const fresh = { chat: async () => ({ content: "recovered", toolCalls: [] }) }
  const r2 = await runTurn(deps(fresh), sessionId, "continue")
  expect(r2.aborted).toBe(false)
  const roles = store.getMessages(sessionId).map(m => m.role)
  expect(roles[roles.length - 1]).toBe("assistant")
})
