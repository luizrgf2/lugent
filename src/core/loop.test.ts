import { test, expect, beforeEach, afterAll } from "bun:test"
import { runTurn, type LoopDeps } from "./loop"
import { Store } from "./store"
import { rmSync, mkdirSync, writeFileSync } from "node:fs"
import type { ChatResponse, Agent } from "./types"
import type { ToolDef } from "./tools/registry"
import { makeSubagentTool } from "./tools/subagent"

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

test("abort with content + tool_calls: next turn has no orphan tool_calls (review F1)", async () => {
  const ac = new AbortController()
  let orphanSeen = false
  let step = 0
  const provider = {
    chat: async (a: any) => {
      step++
      if (step === 1) {
        ac.abort()
        return { content: "Let me check that", toolCalls: [{ id: "t1", name: "echo", args: { path: "a" } }] }
      }
      for (const m of a.messages) {
        if (m.role === "assistant" && m.tool_calls?.length) orphanSeen = true
        if (m.role === "tool" && !a.messages.some((x: any) => x.role === "assistant" && x.tool_calls?.some((t: any) => t.id === m.tool_call_id))) orphanSeen = true
      }
      return { content: "recovered", toolCalls: [] }
    },
  }
  await runTurn(deps(provider, { signal: ac.signal }), sessionId, "go")
  expect(store.loadSession(sessionId)!.aborted).toBe(true)
  const r2 = await runTurn(deps(provider), sessionId, "continue")
  expect(r2.aborted).toBe(false)
  expect(orphanSeen).toBe(false)
})

test("crash between tool results: partial results keep valid wire format (review F2)", async () => {
  // simulate crash: assistant asked t1+t2, only t1 result stored
  store.appendMessage({ id: "ma", sessionId, role: "assistant", content: null,
    toolCalls: [{ id: "t1", name: "echo", args: { path: "a" } }, { id: "t2", name: "echo", args: { path: "b" } }],
    createdAt: new Date().toISOString() })
  store.appendMessage({ id: "mt1", sessionId, role: "tool", content: "echoed:a", toolCallId: "t1",
    createdAt: new Date().toISOString() })

  let orphanSeen = false
  const provider = {
    chat: async (a: any) => {
      const tools = a.messages.filter((m: any) => m.role === "tool")
      const calls = a.messages.filter((m: any) => m.role === "assistant" && m.tool_calls)
      const callIds = calls.flatMap((m: any) => m.tool_calls.map((t: any) => t.id))
      for (const id of callIds) {
        if (!tools.some((t: any) => t.tool_call_id === id)) orphanSeen = true
      }
      for (const t of tools) {
        if (!callIds.includes(t.tool_call_id)) orphanSeen = true
      }
      return { content: "resumed", toolCalls: [] }
    },
  }
  const r = await runTurn(deps(provider), sessionId, "continue")
  expect(r.aborted).toBe(false)
  expect(orphanSeen).toBe(false)
})

test("outside-project resource forces ask even for allow-tools (review F4)", async () => {
  let asked = 0
  let step = 0
  const provider = {
    chat: async () => {
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "echo", args: { path: "/etc/passwd" } }] }
      return { content: "ok", toolCalls: [] }
    },
  }
  const r = await runTurn(deps(provider, { onAsk: async () => { asked++; return "n" as const } }), sessionId, "go")
  expect(asked).toBe(1)
  expect(store.getMessages(sessionId).find(m => m.role === "tool")!.content).toContain("permission denied")
})

test("inside-project allow-tool does not ask (review F4)", async () => {
  let asked = 0
  let step = 0
  const provider = {
    chat: async () => {
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "echo", args: { path: "a.txt" } }] }
      return { content: "ok", toolCalls: [] }
    },
  }
  await runTurn(deps(provider, { onAsk: async () => { asked++; return "y" as const } }), sessionId, "go")
  expect(asked).toBe(0)
  expect(store.getMessages(sessionId).find(m => m.role === "tool")!.content).toBe("echoed:a.txt")
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

test("onReasoning is forwarded to provider.chat", async () => {
  let seen: unknown = undefined
  const provider = {
    chat: async (a: any) => {
      seen = a.onReasoning
      return { content: "done", toolCalls: [] } as ChatResponse
    },
  }
  const noop = () => {}
  await runTurn(deps(provider, { onReasoning: noop }), sessionId, "hi")
  expect(seen).toBe(noop)
})

test("yolo mode runs ask tools without ever calling onAsk", async () => {
  const askTool: ToolDef = {
    name: "edit", description: "edit", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    permission: "ask", execute: async (a) => ({ output: `edited:${a.path}` }),
  }
  let calls = 0
  const provider = {
    chat: async () => {
      if (calls++ === 0) return { content: "", toolCalls: [{ id: "t1", name: "edit", args: { path: `${DIR}/a.txt` } }] }
      return { content: "done", toolCalls: [] }
    },
  }
  let asked = 0
  const r = await runTurn(deps(provider, { tools: [askTool], yolo: true, onAsk: async () => { asked++; return "n" as const } }), sessionId, "go")
  expect(r.error).toBeUndefined()
  expect(asked).toBe(0)                       // yolo short-circuits the ask
  const msgs = store.getMessages(sessionId)
  expect(msgs.some(m => m.role === "tool" && m.content?.includes("edited:"))).toBe(true)
})

test("agent tools list filters the toolset sent to the provider", async () => {
  const seen: string[][] = []
  const provider = {
    chat: async (a: any) => { seen.push(a.tools.map((t: any) => t.name)); return { content: "ok", toolCalls: [] } },
  }
  const agent = { id: "rev", prompt: "review", tools: ["echo"] }
  await runTurn(deps(provider, { agent }), sessionId, "go")
  expect(seen[0]).toEqual(["echo"])
})

test("agent deny removes a tool even when it is listed", async () => {
  const seen: string[][] = []
  const provider = {
    chat: async (a: any) => { seen.push(a.tools.map((t: any) => t.name)); return { content: "ok", toolCalls: [] } },
  }
  const agent = { id: "rev", prompt: "review", tools: ["echo", "boom"], permissions: { boom: "deny" as const } }
  await runTurn(deps(provider, { agent }), sessionId, "go")
  expect(seen[0]).toEqual(["echo"])
})

test("agent permission override turns an ask-tool into allow (no onAsk call)", async () => {
  const askTool: ToolDef = { ...echoTool, name: "asktool", permission: "ask" }
  let asked = 0
  let step = 0
  const provider = {
    chat: async () => {
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "asktool", args: { path: "x" } }] }
      return { content: "ok", toolCalls: [] }
    },
  }
  const agent = { id: "rev", prompt: "review", permissions: { asktool: "allow" as const } }
  await runTurn(deps(provider, { tools: [askTool], agent, onAsk: async () => { asked++; return "n" as const } }), sessionId, "go")
  expect(asked).toBe(0)
})

test("agent ask override on an allow-tool does ask", async () => {
  let asked = 0
  let step = 0
  const provider = {
    chat: async () => {
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "echo", args: { path: "a" } }] }
      return { content: "ok", toolCalls: [] }
    },
  }
  const agent = { id: "rev", prompt: "review", permissions: { echo: "ask" as const } }
  await runTurn(deps(provider, { agent, onAsk: async () => { asked++; return "y" as const } }), sessionId, "go")
  expect(asked).toBe(1)
})

test("runTurn keeps going while the model keeps calling tools (no round cap)", async () => {
  let rounds = 0
  const provider = {
    chat: async () => {
      rounds++
      if (rounds > 60) return { content: "done", toolCalls: [] }   // model stops on its own
      return { content: "", toolCalls: [{ id: `t${rounds}`, name: "echo", args: { path: "a" } }] }
    },
  }
  const r = await runTurn(deps(provider), sessionId, "go")
  expect(r.error).toBeUndefined()
  expect(rounds).toBe(61)   // past the old 50-round cap, turn still completes normally
})

test("session grant still beats an agent ask override (review focus 4)", async () => {
  store.grantPermission(sessionId, "echo", "a")
  let asked = 0
  let step = 0
  const provider = {
    chat: async () => {
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "echo", args: { path: "a" } }] }
      return { content: "ok", toolCalls: [] }
    },
  }
  const agent = { id: "rev", prompt: "review", permissions: { echo: "ask" as const } }
  await runTurn(deps(provider, { agent, onAsk: async () => { asked++; return "n" as const } }), sessionId, "go")
  expect(asked).toBe(0)
})

const subagentTool = makeSubagentTool()

test("subagent: spawns a child session, links it, and returns its last message", async () => {
  const reviewer: Agent = { id: "reviewer", mode: "subagent", prompt: "You are REVIEWER.", tools: ["echo"] }
  const seenChildTools: string[][] = []
  let parentRounds = 0
  const provider = {
    chat: async (a: any) => {
      const sys: string = a.messages[0].content
      if (sys.includes("You are REVIEWER.")) {
        seenChildTools.push(a.tools.map((t: any) => t.name))
        return { content: "child answer", toolCalls: [] }
      }
      parentRounds++
      if (parentRounds === 1) return { content: "", toolCalls: [{ id: "t1", name: "subagent", args: { agent: "reviewer", prompt: "review a.txt" } }] }
      return { content: "parent done", toolCalls: [] }
    },
  }
  const r = await runTurn(deps(provider, { tools: [...tools, subagentTool], agents: [reviewer] }), sessionId, "go")
  expect(r.aborted).toBe(false)
  const toolMsg = store.getMessages(sessionId).find(m => m.role === "tool")!
  expect(toolMsg.content).toBe("child answer")
  const kids = store.children(sessionId)
  expect(kids.length).toBe(1)
  expect(kids[0].agent).toBe("reviewer")
  expect(kids[0].parent).toBe(sessionId)
  expect(seenChildTools[0]).toEqual(["echo"])   // depth 1: the child list has no subagent
})

test("subagent: two launches in one turn overlap", async () => {
  const reviewer: Agent = { id: "reviewer", mode: "subagent", prompt: "You are REVIEWER." }
  const auditor: Agent = { id: "auditor", mode: "subagent", prompt: "You are AUDITOR." }
  const events: string[] = []
  let parentRounds = 0
  const provider = {
    chat: async (a: any) => {
      const sys: string = a.messages[0].content
      const which = sys.includes("REVIEWER") ? "reviewer" : sys.includes("AUDITOR") ? "auditor" : ""
      if (which) {
        events.push(`start:${which}`)
        await new Promise(r => setTimeout(r, 20))
        events.push(`end:${which}`)
        return { content: `done:${which}`, toolCalls: [] }
      }
      parentRounds++
      if (parentRounds === 1) return { content: "", toolCalls: [
        { id: "t1", name: "subagent", args: { agent: "reviewer", prompt: "a" } },
        { id: "t2", name: "subagent", args: { agent: "auditor", prompt: "b" } },
      ] }
      return { content: "parent done", toolCalls: [] }
    },
  }
  await runTurn(deps(provider, { tools: [...tools, subagentTool], agents: [reviewer, auditor] }), sessionId, "go")
  const results = store.getMessages(sessionId).filter(m => m.role === "tool").map(m => m.content).sort()
  expect(results).toEqual(["done:auditor", "done:reviewer"])
  expect(events.slice(0, 2).every(e => e.startsWith("start:"))).toBe(true)   // both began before either finished
})

test("subagent: unknown or primary agent is an error result, never a throw", async () => {
  const build: Agent = { id: "build", prompt: "base" }   // no mode → primary
  let parentRounds = 0
  const provider = {
    chat: async () => {
      parentRounds++
      if (parentRounds === 1) return { content: "", toolCalls: [
        { id: "t1", name: "subagent", args: { agent: "ghost", prompt: "a" } },
        { id: "t2", name: "subagent", args: { agent: "build", prompt: "b" } },
      ] }
      return { content: "done", toolCalls: [] }
    },
  }
  const r = await runTurn(deps(provider, { tools: [...tools, subagentTool], agents: [build] }), sessionId, "go")
  expect(r.aborted).toBe(false)
  const results = store.getMessages(sessionId).filter(m => m.role === "tool").map(m => m.content ?? "")
  expect(results.some(c => c.includes("unknown subagent: ghost"))).toBe(true)
  expect(results.some(c => c.includes("is not a subagent"))).toBe(true)
})

test("subagent: an agent with a configured model runs on providerFor, not the parent", async () => {
  const pinned: Agent = { id: "pinned", mode: "subagent", model: { provider: "alt", model: "m2" }, prompt: "You are PINNED." }
  const built: Array<[string, string]> = []
  const childProvider = { chat: async () => ({ content: "from alt", toolCalls: [] }) }
  let parentRounds = 0
  const provider = {
    chat: async () => {
      parentRounds++
      if (parentRounds === 1) return { content: "", toolCalls: [{ id: "t1", name: "subagent", args: { agent: "pinned", prompt: "x" } }] }
      return { content: "parent done", toolCalls: [] }
    },
  }
  await runTurn(deps(provider, {
    tools: [...tools, subagentTool], agents: [pinned],
    config: { providers: { alt: { baseUrl: "http://x" } } } as any,
    providerFor: (p, m) => { built.push([p, m]); return childProvider },
  }), sessionId, "go")
  expect(built).toEqual([["alt", "m2"]])
  expect(store.getMessages(sessionId).find(m => m.role === "tool")!.content).toBe("from alt")
  expect(store.children(sessionId)[0].provider).toBe("alt")
  expect(store.children(sessionId)[0].model).toBe("m2")
})
