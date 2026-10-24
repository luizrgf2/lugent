import { MCP_TIMEOUT } from "../protocol"
import { McpAuthRequiredError, McpOAuthError } from "./errors"
import { getEntry, putEntry, type McpOAuthEntry } from "./store"
import { refreshTokens } from "./token"
import type { FetchImpl } from "./request"

export type TokenProvider = (o?: { force?: boolean }) => Promise<string | undefined>

/** A token that expires while a request is in flight is already useless. */
const SKEW_SECONDS = 60

/** One refresh per server, even under concurrent requests. */
const inflight = new Map<string, Promise<string | undefined>>()

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function makeTokenProvider(o: {
  storePath: string
  name: string
  serverUrl: string
  timeout?: number
  fetchImpl?: FetchImpl
}): TokenProvider {
  let cached: { token: string; expiresAt?: number } | undefined

  return async (call = {}) => {
    // URL-bound lookup: an entry written for another url must never be sent.
    const entry = getEntry(o.storePath, o.name, o.serverUrl)
    if (!entry?.tokens) { cached = undefined; return undefined }

    const stillGood = entry.tokens.expiresAt === undefined || entry.tokens.expiresAt - nowSeconds() > SKEW_SECONDS
    if (!call.force) {
      if (cached && cached.token === entry.tokens.accessToken && stillGood) return cached.token
      if (stillGood) { cached = { token: entry.tokens.accessToken, expiresAt: entry.tokens.expiresAt }; return cached.token }
    }

    const pending = inflight.get(o.name)
    if (pending) return pending
    const p = refresh(o, entry).finally(() => inflight.delete(o.name))
    inflight.set(o.name, p)
    const token = await p
    cached = { token, expiresAt: undefined }
    return token
  }
}

async function refresh(
  o: { storePath: string; name: string; timeout?: number; fetchImpl?: FetchImpl },
  entry: McpOAuthEntry,
): Promise<string> {
  const refreshToken = entry.tokens?.refreshToken
  if (!refreshToken) throw new McpAuthRequiredError(o.name)

  let tokens
  try {
    tokens = await refreshTokens({
      tokenEndpoint: entry.tokenEndpoint, clientId: entry.clientId, refreshToken,
      resource: entry.resource, timeout: o.timeout ?? MCP_TIMEOUT, fetchImpl: o.fetchImpl,
    })
  } catch (e) {
    if (e instanceof McpOAuthError && (e.code === "invalid_grant" || e.code === "invalid_client" || e.code === "unauthorized_client")) {
      // The stored grant is dead: drop the tokens so /mcp reports auth_required.
      putEntry(o.storePath, o.name, { ...entry, tokens: undefined })
      throw new McpAuthRequiredError(o.name, `server ${o.name} requires OAuth authorization — the stored refresh token was rejected (${e.code}); open /mcp and choose authenticate`)
    }
    throw e   // a transient failure must not log the user out
  }
  // Rotation is optional: keep the old refresh token when the server sends none.
  const merged = { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
  putEntry(o.storePath, o.name, { ...entry, tokens: merged })
  return merged.accessToken
}
