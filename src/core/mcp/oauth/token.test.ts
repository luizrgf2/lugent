import { test, expect } from "bun:test"
import { exchangeCode, refreshTokens, revokeToken } from "./token"
import type { FetchImpl } from "./request"

const ENDPOINT = "https://as.example/oauth/token"
const RESOURCE = "https://mcp.example/mcp"

function capture() {
  const forms: Record<string, string>[] = []
  const fetchImpl: FetchImpl = async (_url, init) => {
    forms.push(Object.fromEntries(new URLSearchParams(String(init?.body))))
    return Response.json({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "agents:read" })
  }
  return { forms, fetchImpl }
}

test("exchangeCode posts a PKCE authorization_code grant and maps the response", async () => {
  const { forms, fetchImpl } = capture()
  const before = Math.floor(Date.now() / 1000)
  const set = await exchangeCode({
    tokenEndpoint: ENDPOINT, code: "c1", redirectUri: "http://127.0.0.1:48762/oauth/callback",
    clientId: "client-1", codeVerifier: "v1", resource: RESOURCE, fetchImpl,
  })
  expect(forms[0]).toEqual({
    grant_type: "authorization_code", code: "c1", redirect_uri: "http://127.0.0.1:48762/oauth/callback",
    client_id: "client-1", code_verifier: "v1", resource: RESOURCE,
  })
  expect(set.accessToken).toBe("at-1")
  expect(set.refreshToken).toBe("rt-1")
  expect(set.scope).toBe("agents:read")
  expect(set.expiresAt).toBeGreaterThanOrEqual(before + 3600)
  expect(set.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 3600)
})

test("refreshTokens sends only the refresh grant and no verifier", async () => {
  const { forms, fetchImpl } = capture()
  await refreshTokens({ tokenEndpoint: ENDPOINT, clientId: "client-1", refreshToken: "rt-1", resource: RESOURCE, fetchImpl })
  expect(forms[0]).toEqual({
    grant_type: "refresh_token", refresh_token: "rt-1", client_id: "client-1", resource: RESOURCE,
  })
  expect("code_verifier" in forms[0]).toBe(false)
})

test("a response without refresh_token or expires_in leaves both undefined (rotation is optional)", async () => {
  const fetchImpl: FetchImpl = async () => Response.json({ access_token: "at-2" })
  const set = await refreshTokens({ tokenEndpoint: ENDPOINT, clientId: "c", refreshToken: "rt", resource: RESOURCE, fetchImpl })
  expect(set).toEqual({ accessToken: "at-2", refreshToken: undefined, expiresAt: undefined, scope: undefined })
})

test("a rotated refresh_token replaces the old one", async () => {
  const fetchImpl: FetchImpl = async () => Response.json({ access_token: "at-3", refresh_token: "rt-3" })
  expect((await refreshTokens({ tokenEndpoint: ENDPOINT, clientId: "c", refreshToken: "rt-1", resource: RESOURCE, fetchImpl })).refreshToken).toBe("rt-3")
})

test("invalid_grant surfaces as an McpOAuthError carrying the code", async () => {
  const fetchImpl: FetchImpl = async () => Response.json({ error: "invalid_grant", error_description: "expired" }, { status: 400 })
  const err: any = await refreshTokens({ tokenEndpoint: ENDPOINT, clientId: "c", refreshToken: "rt", resource: RESOURCE, fetchImpl }).catch(e => e)
  expect(err.code).toBe("invalid_grant")
  expect(err.status).toBe(400)
})

test("a 200 without access_token is an error, not a silent empty token", async () => {
  const fetchImpl: FetchImpl = async () => Response.json({ scope: "x" })
  await expect(exchangeCode({ tokenEndpoint: ENDPOINT, code: "c", redirectUri: "r", clientId: "c", codeVerifier: "v", resource: RESOURCE, fetchImpl }))
    .rejects.toThrow(/no "access_token"/)
})

test("revokeToken posts the token with its hint and tolerates an empty 200", async () => {
  let form: Record<string, string> = {}
  const fetchImpl: FetchImpl = async (_url, init) => { form = Object.fromEntries(new URLSearchParams(String(init?.body))); return new Response(null, { status: 200 }) }
  await revokeToken({ revocationEndpoint: "https://as.example/oauth/revoke", clientId: "c", token: "rt-1", fetchImpl })
  expect(form).toEqual({ token: "rt-1", token_type_hint: "refresh_token", client_id: "c" })
})
