import { test, expect } from "bun:test"
import { registerClient } from "./register"
import type { FetchImpl } from "./request"

const ENDPOINT = "https://as.example/oauth/register"
const REDIRECT = "http://127.0.0.1:48762/oauth/callback"

test("registerClient posts the public-client metadata and returns the client id", async () => {
  let sent: any
  const fetchImpl: FetchImpl = async (_url, init) => {
    sent = JSON.parse(String(init?.body))
    return Response.json({ client_id: "client-1" })
  }
  expect(await registerClient({ registrationEndpoint: ENDPOINT, redirectUri: REDIRECT, fetchImpl })).toEqual({ clientId: "client-1" })
  expect(sent).toEqual({
    redirect_uris: [REDIRECT],
    client_name: "lugent",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  })
  expect("scope" in sent).toBe(false)   // no scopes configured: no scope parameter at all
})

test("registerClient sends scope only when scopes are configured", async () => {
  let sent: any
  const fetchImpl: FetchImpl = async (_url, init) => { sent = JSON.parse(String(init?.body)); return Response.json({ client_id: "c" }) }
  await registerClient({ registrationEndpoint: ENDPOINT, redirectUri: REDIRECT, scopes: ["agents:read", "knowledge:write"], fetchImpl })
  expect(sent.scope).toBe("agents:read knowledge:write")
})

test("registerClient fails clearly when the server returns no client_id", async () => {
  const fetchImpl: FetchImpl = async () => Response.json({ redirect_uris: [REDIRECT] })
  await expect(registerClient({ registrationEndpoint: ENDPOINT, redirectUri: REDIRECT, fetchImpl })).rejects.toThrow(/no "client_id"/)
})
