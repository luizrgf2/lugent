import { test, expect } from "bun:test"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeTokenProvider, nowSeconds } from "./session"
import { getEntry, putEntry, type McpOAuthEntry } from "./store"
import type { FetchImpl } from "./request"

const SERVER = "https://mcp.example/mcp"
const storePath = () => join(tmpdir(), `mcp-oauth-session-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)

function seed(path: string, over: Partial<NonNullable<McpOAuthEntry["tokens"]>> = {}, entryOver: Partial<McpOAuthEntry> = {}): McpOAuthEntry {
  const entry: McpOAuthEntry = {
    serverUrl: SERVER, resource: SERVER, issuer: "https://as.example", clientId: "c1",
    tokenEndpoint: "https://as.example/oauth/token",
    tokens: { accessToken: "at-old", refreshToken: "rt-1", expiresAt: nowSeconds() + 3600, ...over },
    ...entryOver,
  }
  putEntry(path, "tf", entry)
  return entry
}

function refresher(reply: () => Response) {
  const calls: string[] = []
  const fetchImpl: FetchImpl = async (_url, init) => { calls.push(String(init?.body)); return reply() }
  return { calls, fetchImpl }
}

test("no stored entry: no token, and nothing is fetched", async () => {
  const path = storePath()
  const { calls, fetchImpl } = refresher(() => Response.json({}))
  expect(await makeTokenProvider({ storePath: path, name: "tf", serverUrl: SERVER, fetchImpl })()).toBeUndefined()
  expect(calls).toEqual([])
  rmSync(path, { force: true })
})

test("an entry stored for another serverUrl yields no token (never leak across urls)", async () => {
  const path = storePath()
  seed(path)
  const provider = makeTokenProvider({ storePath: path, name: "tf", serverUrl: "https://evil.example/mcp", fetchImpl: async () => { throw new Error("must not be called") } })
  expect(await provider()).toBeUndefined()
  rmSync(path, { force: true })
})

test("a fresh token is returned as-is, without touching the network", async () => {
  const path = storePath()
  seed(path)
  const { calls, fetchImpl } = refresher(() => Response.json({}))
  expect(await makeTokenProvider({ storePath: path, name: "tf", serverUrl: SERVER, fetchImpl })()).toBe("at-old")
  expect(calls).toEqual([])
  rmSync(path, { force: true })
})

test("a token expiring exactly now is refreshed (skew is 60s), and the new one is stored", async () => {
  const path = storePath()
  seed(path, { expiresAt: nowSeconds() })
  const { calls, fetchImpl } = refresher(() => Response.json({ access_token: "at-new", refresh_token: "rt-2", expires_in: 3600 }))
  expect(await makeTokenProvider({ storePath: path, name: "tf", serverUrl: SERVER, fetchImpl })()).toBe("at-new")
  expect(calls).toHaveLength(1)
  expect(getEntry(path, "tf", SERVER)!.tokens).toEqual({ accessToken: "at-new", refreshToken: "rt-2", expiresAt: expect.any(Number), scope: undefined })
  rmSync(path, { force: true })
})

test("the old refresh token survives a response that does not rotate it", async () => {
  const path = storePath()
  seed(path, { expiresAt: nowSeconds() - 10 })
  const { fetchImpl } = refresher(() => Response.json({ access_token: "at-new", expires_in: 3600 }))
  await makeTokenProvider({ storePath: path, name: "tf", serverUrl: SERVER, fetchImpl })()
  expect(getEntry(path, "tf", SERVER)!.tokens!.refreshToken).toBe("rt-1")
  rmSync(path, { force: true })
})

test("force refreshes even a token that still looks fresh (the 401 path)", async () => {
  const path = storePath()
  seed(path)
  const { calls, fetchImpl } = refresher(() => Response.json({ access_token: "at-new", refresh_token: "rt-1", expires_in: 3600 }))
  expect(await makeTokenProvider({ storePath: path, name: "tf", serverUrl: SERVER, fetchImpl })({ force: true })).toBe("at-new")
  expect(calls).toHaveLength(1)
  rmSync(path, { force: true })
})

test("concurrent calls share one refresh (no stampede)", async () => {
  const path = storePath()
  seed(path, { expiresAt: nowSeconds() - 10 })
  const { calls, fetchImpl } = refresher(() => Response.json({ access_token: "at-new", refresh_token: "rt-1", expires_in: 3600 }))
  const provider = makeTokenProvider({ storePath: path, name: "tf", serverUrl: SERVER, fetchImpl })
  const [a, b] = await Promise.all([provider(), provider()])
  expect([a, b]).toEqual(["at-new", "at-new"])
  expect(calls).toHaveLength(1)
  rmSync(path, { force: true })
})

test("expired with no refresh token asks for authorization, without a request", async () => {
  const path = storePath()
  seed(path, { refreshToken: undefined, expiresAt: nowSeconds() - 10 })
  const { calls, fetchImpl } = refresher(() => Response.json({}))
  await expect(makeTokenProvider({ storePath: path, name: "tf", serverUrl: SERVER, fetchImpl })()).rejects.toThrow(/requires OAuth authorization/)
  expect(calls).toEqual([])
  rmSync(path, { force: true })
})

test("invalid_grant clears the tokens so /mcp can report auth_required", async () => {
  const path = storePath()
  seed(path, { expiresAt: nowSeconds() - 10 })
  const { fetchImpl } = refresher(() => Response.json({ error: "invalid_grant" }, { status: 400 }))
  await expect(makeTokenProvider({ storePath: path, name: "tf", serverUrl: SERVER, fetchImpl })()).rejects.toThrow(/requires OAuth authorization/)
  expect(getEntry(path, "tf", SERVER)!.tokens).toBeUndefined()
  expect(getEntry(path, "tf", SERVER)!.clientId).toBe("c1")   // the registration is still good
  rmSync(path, { force: true })
})

test("a network failure on refresh propagates as-is (it is not an auth problem)", async () => {
  const path = storePath()
  seed(path, { expiresAt: nowSeconds() - 10 })
  const fetchImpl: FetchImpl = async () => { throw new Error("socket hang up") }
  await expect(makeTokenProvider({ storePath: path, name: "tf", serverUrl: SERVER, fetchImpl })()).rejects.toThrow(/socket hang up/)
  expect(getEntry(path, "tf", SERVER)!.tokens).toBeDefined()   // a transient failure must not log the user out
  rmSync(path, { force: true })
})
