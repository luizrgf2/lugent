import { test, expect } from "bun:test"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { authenticate } from "./flow"
import type { FetchImpl } from "./request"
import { getEntry, putEntry } from "./store"

const ISSUER = "https://as.example"
const MCP_URL = "https://mcp.example/mcp"
const PRM_URL = "https://mcp.example/.well-known/oauth-protected-resource/mcp"
const META_URL = `${ISSUER}/.well-known/oauth-authorization-server`
const storePath = () => join(tmpdir(), `mcp-oauth-flow-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)

interface FakeAs { fetchImpl: FetchImpl; calls: string[]; bodies: Record<string, string>[] }

function fakeAs(over: { issuerInResponse?: boolean; clientId?: string; token?: any; tokenStatus?: number } = {}): FakeAs {
  const calls: string[] = []
  const bodies: Record<string, string>[] = []
  const fetchImpl: FetchImpl = async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`)
    if (init?.body && typeof init.body === "string") {
      const ct = String((init.headers as any)?.["content-type"] ?? "")
      bodies.push(ct.includes("form")
        ? Object.fromEntries(new URLSearchParams(init.body))
        : JSON.parse(init.body))
    }
    if (url === MCP_URL) return new Response("nope", { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${PRM_URL}"` } })
    if (url === PRM_URL) return Response.json({ resource: MCP_URL, authorization_servers: [ISSUER] })
    if (url === META_URL) return Response.json({
      issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth/authorize`, token_endpoint: `${ISSUER}/oauth/token`,
      registration_endpoint: `${ISSUER}/oauth/register`, revocation_endpoint: `${ISSUER}/oauth/revoke`,
      code_challenge_methods_supported: ["S256"],
      ...(over.issuerInResponse ? { authorization_response_iss_parameter_supported: true } : {}),
    })
    if (url === `${ISSUER}/oauth/register`) return Response.json({ client_id: over.clientId ?? "client-1" })
    if (url === `${ISSUER}/oauth/token`) {
      if (over.tokenStatus && over.tokenStatus !== 200) return Response.json(over.token ?? { error: "invalid_client" }, { status: over.tokenStatus })
      return Response.json(over.token ?? { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "agents:read" })
    }
    return new Response("not found", { status: 404 })
  }
  return { fetchImpl, calls, bodies }
}

/** Plays the browser: reads the authorization URL, then fetches the loopback redirect like a browser redirect would. */
function browser(extra: Record<string, string> = {}) {
  let authorizeUrl = ""
  const openBrowser = async (url: string) => {
    authorizeUrl = url
    const u = new URL(url)
    const cb = new URL(u.searchParams.get("redirect_uri")!)
    cb.searchParams.set("code", "code-1")
    cb.searchParams.set("state", u.searchParams.get("state")!)
    for (const [k, v] of Object.entries(extra)) cb.searchParams.set(k, v)
    const res = await fetch(cb)
    expect(res.status).toBe(200)
  }
  return { openBrowser, url: () => authorizeUrl }
}

test("authenticate: probe → discovery → register → consent → callback → exchange → store", async () => {
  const path = storePath()
  const as = fakeAs()
  const b = browser({ iss: ISSUER })
  await authenticate({ name: "tf", serverUrl: MCP_URL, storePath: path, port: 0, fetchImpl: as.fetchImpl, openBrowser: b.openBrowser })

  const u = new URL(b.url())
  expect(u.origin + u.pathname).toBe(`${ISSUER}/oauth/authorize`)
  expect(u.searchParams.get("response_type")).toBe("code")
  expect(u.searchParams.get("client_id")).toBe("client-1")
  expect(u.searchParams.get("code_challenge_method")).toBe("S256")
  expect(u.searchParams.get("resource")).toBe(MCP_URL)
  expect(u.searchParams.get("redirect_uri")).toStartWith("http://127.0.0.1:")
  expect(u.searchParams.get("scope")).toBe(null)   // no scopes configured: the parameter is absent, not empty
  expect(u.searchParams.get("state")).toMatch(/^[0-9a-f]{64}$/)

  expect(as.calls.find(c => c.endsWith("/oauth/register"))).toBe(`POST ${ISSUER}/oauth/register`)
  const exchange = as.bodies.find(x => x.grant_type === "authorization_code")!
  expect(exchange.resource).toBe(MCP_URL)
  expect(exchange.code_verifier).toMatch(/^[A-Za-z0-9\-._~]{43}$/)

  const entry = getEntry(path, "tf", MCP_URL)!
  expect(entry.issuer).toBe(ISSUER)
  expect(entry.clientId).toBe("client-1")
  expect(entry.tokenEndpoint).toBe(`${ISSUER}/oauth/token`)
  expect(entry.revocationEndpoint).toBe(`${ISSUER}/oauth/revoke`)
  expect(entry.tokens?.accessToken).toBe("at-1")
  rmSync(path, { force: true })
})

test("authenticate sends scope only when scopes are configured", async () => {
  const path = storePath()
  const as = fakeAs()
  const b = browser({ iss: ISSUER })
  await authenticate({ name: "tf", serverUrl: MCP_URL, storePath: path, port: 0, scopes: ["agents:read", "knowledge:write"], fetchImpl: as.fetchImpl, openBrowser: b.openBrowser })
  expect(new URL(b.url()).searchParams.get("scope")).toBe("agents:read knowledge:write")
  expect(as.bodies.find(x => "scope" in x)?.scope).toBe("agents:read knowledge:write")
  rmSync(path, { force: true })
})

test("authenticate reuses a cached client registration for the same issuer", async () => {
  const path = storePath()
  putEntry(path, "tf", { serverUrl: MCP_URL, resource: MCP_URL, issuer: ISSUER, clientId: "cached-9", tokenEndpoint: `${ISSUER}/oauth/token` })
  const as = fakeAs()
  const b = browser({ iss: ISSUER })
  await authenticate({ name: "tf", serverUrl: MCP_URL, storePath: path, port: 0, fetchImpl: as.fetchImpl, openBrowser: b.openBrowser })
  expect(as.calls.some(c => c.endsWith("/oauth/register"))).toBe(false)
  expect(new URL(b.url()).searchParams.get("client_id")).toBe("cached-9")
  rmSync(path, { force: true })
})

test("a rejected cached registration is discarded with an actionable message", async () => {
  const path = storePath()
  putEntry(path, "tf", { serverUrl: MCP_URL, resource: MCP_URL, issuer: ISSUER, clientId: "cached-9", tokenEndpoint: `${ISSUER}/oauth/token` })
  const as = fakeAs({ token: { error: "invalid_client" }, tokenStatus: 401 })
  const b = browser({ iss: ISSUER })
  await expect(authenticate({ name: "tf", serverUrl: MCP_URL, storePath: path, port: 0, fetchImpl: as.fetchImpl, openBrowser: b.openBrowser }))
    .rejects.toThrow(/run authenticate again/)
  expect(getEntry(path, "tf", MCP_URL)).toBeUndefined()   // cache dropped: the next attempt registers fresh
  rmSync(path, { force: true })
})

test("a server that does not need OAuth fails before any browser opens", async () => {
  const path = storePath()
  let opened = false
  const fetchImpl: FetchImpl = async () => Response.json({ ok: true })
  await expect(authenticate({ name: "tf", serverUrl: MCP_URL, storePath: path, port: 0, fetchImpl, openBrowser: () => { opened = true } }))
    .rejects.toThrow(/does not require OAuth/)
  expect(opened).toBe(false)
  rmSync(path, { force: true })
})

test("a 401 without resource_metadata names the missing discovery", async () => {
  const path = storePath()
  const fetchImpl: FetchImpl = async () => new Response("", { status: 401 })
  await expect(authenticate({ name: "tf", serverUrl: MCP_URL, storePath: path, port: 0, fetchImpl, openBrowser: () => {} }))
    .rejects.toThrow(/does not advertise OAuth discovery/)
  rmSync(path, { force: true })
})

test("an iss that does not match the issuer discards the code and stores nothing", async () => {
  const path = storePath()
  const as = fakeAs()
  const b = browser({ iss: "https://evil.example" })
  await expect(authenticate({ name: "tf", serverUrl: MCP_URL, storePath: path, port: 0, fetchImpl: as.fetchImpl, openBrowser: b.openBrowser }))
    .rejects.toThrow(/came from https:\/\/evil.example/)
  expect(getEntry(path, "tf", MCP_URL)).toBeUndefined()
  rmSync(path, { force: true })
})

test("a required iss that is missing fails", async () => {
  const path = storePath()
  const as = fakeAs({ issuerInResponse: true })
  const b = browser()   // no iss
  await expect(authenticate({ name: "tf", serverUrl: MCP_URL, storePath: path, port: 0, fetchImpl: as.fetchImpl, openBrowser: b.openBrowser }))
    .rejects.toThrow(/requires an "iss"/)
  rmSync(path, { force: true })
})

test("aborting the signal cancels the waiting listener", async () => {
  const path = storePath()
  const as = fakeAs()
  const ctl = new AbortController()
  const openBrowser = () => { setTimeout(() => ctl.abort(), 20) }   // the browser never comes back
  await expect(authenticate({ name: "tf", serverUrl: MCP_URL, storePath: path, port: 0, fetchImpl: as.fetchImpl, openBrowser, signal: ctl.signal }))
    .rejects.toThrow(/cancelled/)
  rmSync(path, { force: true })
})
