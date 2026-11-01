import { test, expect } from "bun:test"
import { Provider } from "./provider"

function sseBody(chunks: object[]): Response {
  const stream = new ReadableStream({
    start(ctrl) {
      const enc = new TextEncoder()
      for (const c of chunks) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(c)}\n\n`))
      ctrl.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
      ctrl.close()
    },
  })
  return new Response(stream, { status: 200 })
}

test("parseSSE joins tool_call fragments split across chunks (golden #1)", async () => {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "tc1", function: { name: "read", arguments: "" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"pa" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "th\":\"a.ts\"}" } }] } }] },
    { choices: [{ delta: { content: "done" } }] },
  ]
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () => sseBody(chunks)) as any)
  const res = await p.chat({ messages: [{ role: "user", content: "hi" }], tools: [] })
  expect(res.content).toBe("done")
  expect(res.toolCalls).toEqual([{ id: "tc1", name: "read", args: { path: "a.ts" } }])
})

test("chat sends stream:true with tools in OpenAI format", async () => {
  let sent: any
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async (url: string, init: any) => {
    sent = { url, body: JSON.parse(init.body) }
    return sseBody([{ choices: [{ delta: { content: "ok" } }] }])
  }) as any)
  await p.chat({
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "read", description: "Read", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
  })
  expect(sent.url).toBe("http://x/v1/chat/completions")
  expect(sent.body.stream).toBe(true)
  expect(sent.body.tools[0].function.name).toBe("read")
})

test("malformed JSON arguments stay a string; caller validates", async () => {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "tc1", function: { name: "read", arguments: "{oops" } }] } }] },
  ]
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () => sseBody(chunks)) as any)
  const res = await p.chat({ messages: [{ role: "user", content: "hi" }], tools: [] })
  expect(res.toolCalls[0].args).toBe("{oops")
})

test("SSE error event surfaces instead of a silent empty turn", async () => {
  const chunks = [{ error: { message: "upstream overloaded" } }]
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () => sseBody(chunks)) as any)
  await expect(p.chat({ messages: [], tools: [], maxRetries: 1, backoffBaseMs: 50 })).rejects.toThrow(/upstream overloaded/)
})

test("200 with non-stream JSON error body surfaces", async () => {
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () =>
    new Response(JSON.stringify({ error: { message: "model busy" } }), { status: 200, headers: { "content-type": "application/json" } })) as any)
  await expect(p.chat({ messages: [], tools: [], maxRetries: 1, backoffBaseMs: 50 })).rejects.toThrow(/model busy/)
})

test("onRetry reports each retry with delay; retries then succeeds", async () => {
  let calls = 0
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () => {
    calls++
    return calls < 3 ? new Response("down", { status: 503 }) : sseBody([{ choices: [{ delta: { content: "ok" } }] }])
  }) as any)
  const retries: any[] = []
  const res = await p.chat({ messages: [], tools: [], maxRetries: 2, backoffBaseMs: 50, onRetry: i => retries.push(i) })
  expect(res.content).toBe("ok")
  expect(calls).toBe(3)
  expect(retries).toEqual([
    { attempt: 1, delayMs: 50, error: "HTTP 503" },
    { attempt: 2, delayMs: 100, error: "HTTP 503" },
  ])
})

test("client errors (401) fail fast — no infinite retry on a bad key", async () => {
  let calls = 0
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () => {
    calls++
    return new Response("nope", { status: 401 })
  }) as any)
  await expect(p.chat({ messages: [], tools: [] })).rejects.toThrow(/401/)
  expect(calls).toBe(1)
})

test("abort during backoff sleep stops retrying immediately", async () => {
  let calls = 0
  const ac = new AbortController()
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () => {
    calls++
    return new Response("down", { status: 503 })
  }) as any)
  setTimeout(() => ac.abort(), 50)
  await expect(p.chat({ messages: [], tools: [], signal: ac.signal })).rejects.toThrow()
  expect(calls).toBe(1)
})

test("fetch that never returns headers times out and retries instead of hanging", async () => {
  let calls = 0
  // mock honors signal like real fetch: rejects with the abort reason
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", ((url: string, init: any) => {
    calls++
    return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason), { once: true }))
  }) as any)
  await expect(
    Promise.race([
      p.chat({ messages: [], tools: [], headerTimeoutMs: 50, maxRetries: 1, backoffBaseMs: 50 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("test guard: chat never settled")), 3000)),
    ])
  ).rejects.toThrow(/no response within 50ms/)
  expect(calls).toBe(2)
}, 5000)

test("429 retries up to maxRetries then throws with the attempt count", async () => {
  let calls = 0
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () => {
    calls++
    return new Response("rate", { status: 429 })
  }) as any)
  await expect(p.chat({ messages: [], tools: [], maxRetries: 2, backoffBaseMs: 50 })).rejects.toThrow(/429 \(after 3 attempts\)/)
  expect(calls).toBe(3)
})

test("listModels parses ids; health false when unreachable", async () => {
  const ok = new Provider({ baseUrl: "http://x/v1" }, "m", (async () =>
    new Response(JSON.stringify({ data: [{ id: "qwen" }, { id: "llama" }] }), { status: 200 })) as any)
  expect(await ok.listModels()).toEqual(["qwen", "llama"])
  expect(await ok.health()).toBe(true)

  const off = new Provider({ baseUrl: "http://dead/v1" }, "m", (async () => { throw new Error("ECONNREFUSED") }) as any)
  expect(await off.health()).toBe(false)
})

test("onReasoning fires per reasoning_content delta, content stays clean", async () => {
  const chunks = [
    { choices: [{ delta: { reasoning_content: "think " } }] },
    { choices: [{ delta: { reasoning_content: "hard" } }] },
    { choices: [{ delta: { content: "answer" } }] },
  ]
  const got: string[] = []
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () => sseBody(chunks)) as any)
  const res = await p.chat({ messages: [], tools: [], onReasoning: (t) => got.push(t) })
  expect(got).toEqual(["think ", "hard"])
  expect(res.content).toBe("answer")
})

test("provider without reasoning_content never calls onReasoning", async () => {
  const p = new Provider({ baseUrl: "http://x/v1" }, "m",
    (async () => sseBody([{ choices: [{ delta: { content: "ok" } }] }])) as any)
  let called = false
  await p.chat({ messages: [], tools: [], onReasoning: () => { called = true } })
  expect(called).toBe(false)
})

test("onToken fires while the stream is still open (real-time, not burst at end)", async () => {
  // controllable stream: push chunk A, keep stream OPEN, assert onToken already fired
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const enc = new TextEncoder()
  const stream = new ReadableStream({ start(c) { ctrl = c } })
  const res = new Response(stream, { status: 200 })
  let firstTok = ""
  let resolveFirst!: () => void
  const first = new Promise<void>(r => { resolveFirst = r })
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () => res) as any)
  const chatP = p.chat({
    messages: [], tools: [],
    onToken: t => { if (!firstTok) { firstTok = t; resolveFirst() } },
  })
  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "a" } }] })}\n\n`))
  await Promise.race([first, new Promise(r => setTimeout(r, 300))])
  expect(firstTok).toBe("a")          // RED today: parseSSE buffers until stream end
  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "b" } }] })}\n\n`))
  ctrl.enqueue(enc.encode("data: [DONE]\n\n"))
  ctrl.close()
  expect((await chatP).content).toBe("ab")
})

test("idle stream (no chunks) rejects with a stall error instead of hanging", async () => {  const enc = new TextEncoder()
  let calls = 0
  const fetchFn = (async () => {
    calls++
    const stream = new ReadableStream({
      start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "a" } }] })}\n\n`)) },
    })
    return new Response(stream, { status: 200 })
  }) as any
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", fetchFn)
  const chatP = p.chat({ messages: [], tools: [], idleTimeoutMs: 60, maxRetries: 2, backoffBaseMs: 50 })
  await expect(
    Promise.race([chatP, new Promise((_, rej) => setTimeout(() => rej(new Error("test guard: chat never settled")), 6000))])
  ).rejects.toThrow(/stalled/i)
  expect(calls).toBe(3)   // stalls are retried like other chat failures
})

test("keep-alive bytes alone do not keep a stream alive past the total cap", async () => {
  const enc = new TextEncoder()
  // fresh stream per fetch call: chat retries 3x and each needs its own
  const fetchFn = (async () => new Response(new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "a" } }] })}\n\n`))
      // heartbeat comments forever: each byte resets the idle guard...
      const timer = setInterval(() => { try { c.enqueue(enc.encode(": keep-alive\n\n")) } catch { clearInterval(timer) } }, 20)
    },
    cancel() { /* enqueue throwing above clears the interval */ },
  }), { status: 200 })) as any
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", fetchFn)
  await expect(
    Promise.race([
      p.chat({ messages: [], tools: [], idleTimeoutMs: 1_000, totalTimeoutMs: 250, maxRetries: 1, backoffBaseMs: 50 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("test guard: chat never settled")), 6_000)),
    ])
  ).rejects.toThrow(/stream exceeded/)
})

test("a 429 body is cancelled before the retry fires", async () => {
  const cancelled: boolean[] = []
  let calls = 0
  const bodies = () => ({
    get body() {
      let done = false
      return new ReadableStream({
        cancel() { done = true; cancelled.push(done) },
        start(c) { c.enqueue(new TextEncoder().encode("rate")); c.close() },
      })
    },
  })
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () => {
    calls++
    return new Response(bodies().body, { status: 429 })
  }) as any)
  await expect(p.chat({ messages: [], tools: [], maxRetries: 2, backoffBaseMs: 50, signal: new AbortController().signal })).rejects.toThrow("429")
  expect(calls).toBe(3)
  expect(cancelled).toEqual([true, true, true])
})
