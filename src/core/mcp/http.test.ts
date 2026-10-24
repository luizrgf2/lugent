import { test, expect, afterEach } from "bun:test"
import { HttpTransport } from "./http"
import type { JsonRpcMessage } from "./protocol"

let servers: any[] = []
afterEach(() => { for (const s of servers) s.stop(true); servers = [] })

function serve(handler: (req: Request) => Response | Promise<Response>) {
  const s = Bun.serve({ port: 0, fetch: handler })
  servers.push(s)
  return `http://127.0.0.1:${s.port}/mcp`
}

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lugent", version: "0.1.0" } } } as const

async function started(t: HttpTransport) {
  const msgs: JsonRpcMessage[] = []
  const errors: Error[] = []
  await t.start({ onMessage: m => msgs.push(m), onError: e => errors.push(e), onClose: () => {} })
  return { msgs, errors }
}

test("http: json response, session id captured and echoed", async () => {
  const seen: Record<string, string | null> = {}
  const url = serve(async req => {
    const body = await req.json()
    if (body.method === "initialize") {
      seen.initVersion = req.headers.get("mcp-protocol-version")
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "stub" } } }, { headers: { "mcp-session-id": "sess-1" } })
    }
    seen.echoVersion = req.headers.get("mcp-protocol-version")
    seen.echoSession = req.headers.get("mcp-session-id")
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { ok: true } })
  })
  const t = new HttpTransport("stub", url)
  const c = await started(t)
  await t.send(INIT as any)
  await t.send({ jsonrpc: "2.0", id: 2, method: "x", params: {} })
  expect(c.msgs.length).toBe(2)
  expect(seen.initVersion).toBeNull()
  expect(seen.echoVersion).toBe("2025-06-18")
  expect(seen.echoSession).toBe("sess-1")
  await t.close()
})

test("http: sse response is parsed into a message", async () => {
  const url = serve(async req => {
    const body = await req.json()
    const payload = JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { via: "sse" } })
    return new Response(`event: message\ndata: ${payload}\n\n`, { headers: { "content-type": "text/event-stream" } })
  })
  const t = new HttpTransport("stub", url)
  const c = await started(t)
  await t.send({ jsonrpc: "2.0", id: 7, method: "x" })
  expect((c.msgs[0] as any).result).toEqual({ via: "sse" })
  await t.close()
})

test("http: a notification gets 202 and emits no message", async () => {
  const url = serve(async () => new Response(null, { status: 202 }))
  const t = new HttpTransport("stub", url)
  const c = await started(t)
  await t.send({ jsonrpc: "2.0", method: "notifications/initialized" })
  expect(c.msgs).toEqual([])
  await t.close()
})

test("http: 401 raises McpAuthRequiredError with an actionable message", async () => {
  const url = serve(async () => new Response("nope", { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="https://x"' } }))
  const t = new HttpTransport("stub", url)
  await started(t)
  await expect(t.send({ jsonrpc: "2.0", id: 1, method: "initialize" })).rejects.toThrow(/requires OAuth authorization/)
  await t.close()
})

test("http: the provider's token goes out as a bearer and beats a static header", async () => {
  const seen: (string | null)[] = []
  const url = serve(req => { seen.push(req.headers.get("authorization")); return Response.json({ jsonrpc: "2.0", id: 1, result: {} }) })
  const t = new HttpTransport("stub", url, { authorization: "Bearer static" }, 30_000, async () => "at-1")
  await started(t)
  await t.send(INIT as any)
  expect(seen[0]).toBe("Bearer at-1")
  await t.close()
})

test("http: no token from the provider means no authorization header", async () => {
  const seen: (string | null)[] = []
  const url = serve(req => { seen.push(req.headers.get("authorization")); return Response.json({ jsonrpc: "2.0", id: 1, result: {} }) })
  const t = new HttpTransport("stub", url, {}, 30_000, async () => undefined)
  await started(t)
  await t.send(INIT as any)
  expect(seen[0]).toBe(null)
  await t.close()
})

test("http: a 401 forces one refresh and retries with the new token", async () => {
  const seen: (string | null)[] = []
  let force = 0
  const url = serve(req => {
    seen.push(req.headers.get("authorization"))
    if (req.headers.get("authorization") === "Bearer fresh") return Response.json({ jsonrpc: "2.0", id: 1, result: {} })
    return new Response("nope", { status: 401 })
  })
  const tokens = async (o?: { force?: boolean }) => { if (o?.force) { force++; return "fresh" } return "stale" }
  const t = new HttpTransport("stub", url, {}, 30_000, tokens)
  await started(t)
  await t.send(INIT as any)
  expect(seen).toEqual(["Bearer stale", "Bearer fresh"])
  expect(force).toBe(1)
  await t.close()
})

test("http: a 401 that survives the refresh raises auth-required (revoked mid-session)", async () => {
  let requests = 0
  const url = serve(() => { requests++; return new Response("nope", { status: 401 }) })
  let force = 0
  const t = new HttpTransport("stub", url, {}, 30_000, async (o?: { force?: boolean }) => { if (o?.force) force++; return "at-1" })
  await started(t)
  await expect(t.send(INIT as any)).rejects.toThrow(/requires OAuth authorization/)
  expect(force).toBe(1)     // one forced refresh: that is how the transport learns the token is dead
  expect(requests).toBe(1)  // the same token came back, so no pointless second POST
  await t.close()
})

test("http: a stalled server times out", async () => {
  const url = serve(() => new Promise<Response>(() => {}))   // never responds
  const t = new HttpTransport("stub", url, {}, 100)
  await started(t)
  await expect(t.send({ jsonrpc: "2.0", id: 1, method: "initialize" })).rejects.toThrow(/timed out/)
  await t.close()
})

test("http: the protocol version header is still sent when the server omits it", async () => {
  const seen: (string | null)[] = []
  const url = serve(async req => {
    const body = await req.json()
    if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { serverInfo: { name: "stub" } } })   // no protocolVersion
    seen.push(req.headers.get("mcp-protocol-version"))
    return Response.json({ jsonrpc: "2.0", id: body.id, result: {} })
  })
  const t = new HttpTransport("stub", url)
  await started(t)
  await t.send(INIT as any)
  await t.send({ jsonrpc: "2.0", id: 2, method: "x" })
  expect(seen).toEqual(["2025-06-18"])
  await t.close()
})
