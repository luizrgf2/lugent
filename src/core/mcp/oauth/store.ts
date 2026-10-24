import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export interface StoredTokens {
  accessToken: string
  refreshToken?: string
  /** Epoch seconds, the unit the token endpoint returns. */
  expiresAt?: number
  scope?: string
}

export interface McpOAuthEntry {
  serverUrl: string
  resource: string
  issuer: string
  clientId: string
  tokenEndpoint: string
  revocationEndpoint?: string
  tokens?: StoredTokens
}

export type OAuthStoreData = Record<string, McpOAuthEntry>

/** A missing or corrupt file is an empty store — never a crash. */
export function readStore(path: string): OAuthStoreData {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    return parsed && typeof parsed === "object" ? (parsed as OAuthStoreData) : {}
  } catch { return {} }
}

/** Temp + rename: a crash can lose the write, never corrupt the file. */
export function writeStore(path: string, data: OAuthStoreData): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  chmodSync(tmp, 0o600)   // a stale tmp from a killed run keeps its old mode otherwise
  renameSync(tmp, path)
}

/**
 * Tokens are bound to the URL that issued them: a project lugent.json can shadow
 * a global server name, and that must never hand the global credential over.
 */
export function getEntry(path: string, name: string, serverUrl: string): McpOAuthEntry | undefined {
  const e = readStore(path)[name]
  return e && e.serverUrl === serverUrl ? e : undefined
}

/** Re-reads and merges right before writing, so a concurrent writer's other servers survive. */
export function putEntry(path: string, name: string, entry: McpOAuthEntry): void {
  const data = readStore(path)
  data[name] = entry
  writeStore(path, data)
}

export function removeEntry(path: string, name: string): void {
  const data = readStore(path)
  delete data[name]
  writeStore(path, data)
}
