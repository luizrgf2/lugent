import { postForm, type FetchImpl } from "./request"
import { McpOAuthError } from "./errors"

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** Epoch seconds — the unit the endpoint returns, kept as-is. */
  expiresAt?: number
  scope?: string
}

function toTokenSet(raw: any, url: string): TokenSet {
  if (typeof raw?.access_token !== "string" || !raw.access_token)
    throw new McpOAuthError(`token endpoint ${url} returned no "access_token"`)
  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw?.refresh_token === "string" ? raw.refresh_token : undefined,
    expiresAt: typeof raw?.expires_in === "number" && raw.expires_in > 0
      ? Math.floor(Date.now() / 1000) + raw.expires_in
      : undefined,
    scope: typeof raw?.scope === "string" ? raw.scope : undefined,
  }
}

export async function exchangeCode(o: {
  tokenEndpoint: string
  code: string
  redirectUri: string
  clientId: string
  codeVerifier: string
  resource: string
  timeout?: number
  fetchImpl?: FetchImpl
}): Promise<TokenSet> {
  const raw = await postForm(o.tokenEndpoint, {
    grant_type: "authorization_code",
    code: o.code,
    redirect_uri: o.redirectUri,
    client_id: o.clientId,
    code_verifier: o.codeVerifier,
    resource: o.resource,
  }, { what: "token exchange", timeout: o.timeout, fetchImpl: o.fetchImpl })
  return toTokenSet(raw, o.tokenEndpoint)
}

export async function refreshTokens(o: {
  tokenEndpoint: string
  clientId: string
  refreshToken: string
  resource: string
  timeout?: number
  fetchImpl?: FetchImpl
}): Promise<TokenSet> {
  const raw = await postForm(o.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: o.refreshToken,
    client_id: o.clientId,
    resource: o.resource,
  }, { what: "token refresh", timeout: o.timeout, fetchImpl: o.fetchImpl })
  return toTokenSet(raw, o.tokenEndpoint)
}

/** RFC 7009. Some servers reject without the client_id; the caller treats a failure as non-fatal. */
export async function revokeToken(o: {
  revocationEndpoint: string
  clientId: string
  token: string
  timeout?: number
  fetchImpl?: FetchImpl
}): Promise<void> {
  await postForm(o.revocationEndpoint, {
    token: o.token,
    token_type_hint: "refresh_token",
    client_id: o.clientId,
  }, { what: "token revocation", timeout: o.timeout, fetchImpl: o.fetchImpl })
}
