import { test, expect } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getEntry, putEntry, readStore, removeEntry, writeStore, type McpOAuthEntry } from "./store"

const dir = mkdtempSync(join(tmpdir(), "mcp-oauth-store-"))
const path = () => join(dir, `s-${Math.random().toString(36).slice(2)}.json`)

const entry = (over: Partial<McpOAuthEntry> = {}): McpOAuthEntry => ({
  serverUrl: "https://mcp.example/mcp",
  resource: "https://mcp.example/mcp",
  issuer: "https://as.example",
  clientId: "c1",
  tokenEndpoint: "https://as.example/oauth/token",
  tokens: { accessToken: "at", refreshToken: "rt", expiresAt: 2000000000, scope: "a b" },
  ...over,
})

test("put then get round-trips the entry", () => {
  const p = path()
  putEntry(p, "tf", entry())
  expect(getEntry(p, "tf", "https://mcp.example/mcp")?.tokens?.accessToken).toBe("at")
})

test("a stored entry is only returned for the serverUrl it was written for", () => {
  const p = path()
  putEntry(p, "tf", entry())
  expect(getEntry(p, "tf", "https://evil.example/mcp")).toBeUndefined()
})

test("the file is written 0600, even when it already existed with looser bits", () => {
  if (process.platform === "win32") return   // modes are not honoured
  const p = path()
  writeFileSync(p, "{}")
  chmodSync(p, 0o644)
  putEntry(p, "tf", entry())
  expect(statSync(p).mode & 0o777).toBe(0o600)
})

test("corrupt JSON reads as empty instead of throwing", () => {
  const p = path()
  writeFileSync(p, "{ this is not json")
  expect(readStore(p)).toEqual({})
  expect(getEntry(p, "tf", "https://mcp.example/mcp")).toBeUndefined()
})

test("no temp file is left behind", () => {
  const p = path()
  putEntry(p, "tf", entry())
  expect(existsSync(`${p}.${process.pid}.tmp`)).toBe(false)
})

test("removeEntry drops one server and keeps its neighbours", () => {
  const p = path()
  putEntry(p, "a", entry())
  putEntry(p, "b", entry({ serverUrl: "https://other.example/mcp" }))
  removeEntry(p, "a")
  expect(getEntry(p, "a", "https://mcp.example/mcp")).toBeUndefined()
  expect(getEntry(p, "b", "https://other.example/mcp")?.clientId).toBe("c1")
})

test("writeStore creates the directory and writes valid JSON", () => {
  const p = join(dir, "nested", "deep", "store.json")
  writeStore(p, { x: entry() })
  expect(readStore(p).x.clientId).toBe("c1")
})

test("a missing file is an empty store, not an error", () => {
  expect(readStore(join(dir, "never-written.json"))).toEqual({})
})
