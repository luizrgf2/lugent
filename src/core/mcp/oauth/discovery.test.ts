import { test, expect } from "bun:test"
import { authorizationServerMetadataUrl, fetchAuthServerMetadata, fetchProtectedResource, parseWwwAuthenticate } from "./discovery"
import type { FetchImpl } from "./request"

const ISSUER = "https://as.example"

type Replies = Record<string, () => Response>
function fakeFetch(replies: Replies): FetchImpl {
  return async (url: string) => {
    const r = replies[url]
    if (!r) return new Response("not found", { status: 404 })
    return r()
  }
}

const PRM_URL = "https://mcp.example/.well-known/oauth-protected-resource/mcp"
const META_URL = `${ISSUER}/.well-known/oauth-authorization-server`
const meta = (over: Record<string, unknown> = {}) => () => Response.json({
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  code_challenge_methods_supported: ["S256"],
  ...over,
})

test("parseWwwAuthenticate pulls the resource_metadata url out of a Bearer challenge", () => {
  expect(parseWwwAuthenticate(`Bearer resource_metadata="${PRM_URL}"`)).toBe(PRM_URL)
  expect(parseWwwAuthenticate("Bearer realm=other")).toBeUndefined()
  expect(parseWwwAuthenticate(undefined)).toBeUndefined()
})

test("fetchProtectedResource reads resource and authorization_servers", async () => {
  const fetchImpl = fakeFetch({ [PRM_URL]: () => Response.json({ resource: "https://mcp.example/mcp", authorization_servers: [ISSUER] }) })
  expect(await fetchProtectedResource(PRM_URL, { fetchImpl })).toEqual({ resource: "https://mcp.example/mcp", authorizationServers: [ISSUER] })
})

test("fetchProtectedResource refuses a plain-http or bogus prm url without fetching it", async () => {
  let called = false
  const fetchImpl: FetchImpl = async () => { called = true; return Response.json({}) }
  await expect(fetchProtectedResource("http://mcp.example/prm", { fetchImpl })).rejects.toThrow(/must be https/)
  await expect(fetchProtectedResource("not a url", { fetchImpl })).rejects.toThrow(/not a valid URL/)
  expect(called).toBe(false)
})

test("fetchProtectedResource requires resource and a non-empty authorization_servers", async () => {
  await expect(fetchProtectedResource(PRM_URL, { fetchImpl: fakeFetch({ [PRM_URL]: () => Response.json({ authorization_servers: [ISSUER] }) }) }))
    .rejects.toThrow(/no "resource"/)
  await expect(fetchProtectedResource(PRM_URL, { fetchImpl: fakeFetch({ [PRM_URL]: () => Response.json({ resource: "https://mcp.example/mcp", authorization_servers: [] }) }) }))
    .rejects.toThrow(/no "authorization_servers"/)
})

test("fetchProtectedResource rejects an authorization server that is not https", async () => {
  const fetchImpl = fakeFetch({ [PRM_URL]: () => Response.json({ resource: "https://mcp.example/mcp", authorization_servers: ["http://as.example"] }) })
  await expect(fetchProtectedResource(PRM_URL, { fetchImpl })).rejects.toThrow(/must be https/)
})

test("authorizationServerMetadataUrl inserts the well-known segment before the issuer path (RFC 8414)", () => {
  expect(authorizationServerMetadataUrl("https://as.example")).toBe(META_URL)
  expect(authorizationServerMetadataUrl("https://as.example/tenant")).toBe("https://as.example/.well-known/oauth-authorization-server/tenant")
})

test("fetchAuthServerMetadata accepts the metadata and maps the fields", async () => {
  const fetchImpl = fakeFetch({ [META_URL]: meta({ registration_endpoint: `${ISSUER}/oauth/register`, revocation_endpoint: `${ISSUER}/oauth/revoke`, authorization_response_iss_parameter_supported: true }) })
  expect(await fetchAuthServerMetadata(ISSUER, { fetchImpl })).toEqual({
    issuer: ISSUER,
    authorizationEndpoint: `${ISSUER}/oauth/authorize`,
    tokenEndpoint: `${ISSUER}/oauth/token`,
    registrationEndpoint: `${ISSUER}/oauth/register`,
    revocationEndpoint: `${ISSUER}/oauth/revoke`,
    issuerInResponseRequired: true,
  })
})

test("fetchAuthServerMetadata defaults issuerInResponseRequired to false when not advertised", async () => {
  const got = await fetchAuthServerMetadata(ISSUER, { fetchImpl: fakeFetch({ [META_URL]: meta() }) })
  expect(got.issuerInResponseRequired).toBe(false)
})

test("fetchAuthServerMetadata rejects a metadata document that declares another issuer", async () => {
  const fetchImpl = fakeFetch({ [META_URL]: meta({ issuer: "https://evil.example" }) })
  await expect(fetchAuthServerMetadata(ISSUER, { fetchImpl })).rejects.toThrow(/declares issuer/)
})

test("fetchAuthServerMetadata aborts when PKCE S256 is not offered", async () => {
  const fetchImpl = fakeFetch({ [META_URL]: meta({ code_challenge_methods_supported: ["plain"] }) })
  await expect(fetchAuthServerMetadata(ISSUER, { fetchImpl })).rejects.toThrow(/S256/)
})

test("fetchAuthServerMetadata requires the endpoints it will call", async () => {
  await expect(fetchAuthServerMetadata(ISSUER, { fetchImpl: fakeFetch({ [META_URL]: meta({ authorization_endpoint: undefined }) }) }))
    .rejects.toThrow(/authorization_endpoint/)
  await expect(fetchAuthServerMetadata(ISSUER, { fetchImpl: fakeFetch({ [META_URL]: meta({ token_endpoint: undefined }) }) }))
    .rejects.toThrow(/token_endpoint/)
})
