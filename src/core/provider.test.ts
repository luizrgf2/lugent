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

test("429 retries 3x then throws", async () => {
  let calls = 0
  const p = new Provider({ baseUrl: "http://x/v1" }, "m", (async () => {
    calls++
    return new Response("rate", { status: 429 })
  }) as any)
  await expect(p.chat({ messages: [], tools: [] })).rejects.toThrow("429")
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
