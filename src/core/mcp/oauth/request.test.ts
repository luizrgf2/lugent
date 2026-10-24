import { test, expect, afterEach } from "bun:test"
import { getJson, postForm, postJson } from "./request"
import { McpOAuthError } from "./errors"

let servers: any[] = []
afterEach(() => { for (const s of servers) s.stop(true); servers = [] })

function serve(handler: (req: Request) => Response | Promise<Response>) {
  const s = Bun.serve({ port: 0, fetch: handler })
  servers.push(s)
  return `http://127.0.0.1:${s.port}/x`
}

test("getJson: parses json and sends an accept header", async () => {
  let accept: string | null = null
  const url = serve(req => { accept = req.headers.get("accept"); return Response.json({ ok: 1 }) })
  expect(await getJson(url, { what: "thing" })).toEqual({ ok: 1 })
  expect(accept).toBe("application/json")
})

test("getJson: a non-2xx status is an McpOAuthError naming the endpoint", async () => {
  const url = serve(() => new Response("nope", { status: 500 }))
  await expect(getJson(url, { what: "protected resource metadata" })).rejects.toThrow(/protected resource metadata.*HTTP 500/)
})

test("getJson: a timeout is reported as a timeout", async () => {
  const url = serve(() => new Promise<Response>(() => {}))
  await expect(getJson(url, { what: "thing", timeout: 50 })).rejects.toThrow(/timed out after 50ms/)
})

test("postJson: sends json and parses the answer", async () => {
  let body: any
  let ct: string | null = null
  const url = serve(async req => { ct = req.headers.get("content-type"); body = await req.json(); return Response.json({ ok: true }) })
  expect(await postJson(url, { a: 1 }, { what: "registration" })).toEqual({ ok: true })
  expect(ct).toBe("application/json")
  expect(body).toEqual({ a: 1 })
})

test("postForm: url-encodes the form and tolerates an empty body", async () => {
  let raw = ""
  const url = serve(async req => { raw = await req.text(); return new Response(null, { status: 200 }) })
  expect(await postForm(url, { grant_type: "refresh_token" }, { what: "refresh" })).toEqual({})
  expect(raw).toBe("grant_type=refresh_token")
})

test("postForm: an OAuth error body becomes code + description", async () => {
  const url = serve(() => Response.json({ error: "invalid_grant", error_description: "refresh token expired" }, { status: 400 }))
  const err: any = await postForm(url, {}, { what: "refresh" }).catch(e => e)
  expect(err).toBeInstanceOf(McpOAuthError)
  expect(err.code).toBe("invalid_grant")
  expect(err.status).toBe(400)
  expect(err.message).toMatch(/refresh token expired/)
})

test("a 200 that is not JSON is an error, not a silent undefined", async () => {
  const url = serve(() => new Response("<html>you are offline</html>", { status: 200 }))
  await expect(getJson(url, { what: "thing" })).rejects.toThrow(/did not return JSON/)
})
