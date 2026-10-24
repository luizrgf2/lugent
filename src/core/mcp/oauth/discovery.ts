import { getJson, type FetchImpl } from "./request"
import { McpOAuthError } from "./errors"

export interface ProtectedResource { resource: string; authorizationServers: string[] }

export interface AuthServerMeta {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
  revocationEndpoint?: string
  /** RFC 9207: when true, a missing `iss` on the authorization response is a failure. */
  issuerInResponseRequired: boolean
}

/** `WWW-Authenticate: Bearer resource_metadata="…"` → the url. Undefined when absent. */
export function parseWwwAuthenticate(header: string | undefined): string | undefined {
  if (!header) return undefined
  return /resource_metadata="([^"]+)"/.exec(header)?.[1]
}

function requireHttps(url: string, what: string): URL {
  let u: URL
  try { u = new URL(url) } catch { throw new McpOAuthError(`${what} is not a valid URL: ${url}`) }
  if (u.protocol !== "https:") throw new McpOAuthError(`${what} must be https, got ${url}`)
  return u
}

export async function fetchProtectedResource(
  url: string,
  o: { timeout?: number; fetchImpl?: FetchImpl } = {},
): Promise<ProtectedResource> {
  requireHttps(url, "resource_metadata")
  const raw = await getJson(url, { what: "protected resource metadata", timeout: o.timeout, fetchImpl: o.fetchImpl })
  const resource = typeof raw?.resource === "string" ? raw.resource : undefined
  if (!resource) throw new McpOAuthError(`protected resource metadata at ${url} has no "resource"`)
  const servers: unknown[] = Array.isArray(raw?.authorization_servers) ? raw.authorization_servers : []
  const authorizationServers = servers.filter((s): s is string => typeof s === "string")
  if (!authorizationServers.length) throw new McpOAuthError(`protected resource metadata at ${url} lists no "authorization_servers"`)
  for (const s of authorizationServers) requireHttps(s, `authorization server ${s}`)
  return { resource, authorizationServers }
}

/** RFC 8414: the well-known segment goes before the issuer's path, not after it. */
export function authorizationServerMetadataUrl(issuer: string): string {
  const u = requireHttps(issuer, "authorization server issuer")
  const path = u.pathname.replace(/\/+$/, "")
  return `${u.origin}/.well-known/oauth-authorization-server${path}`
}

export async function fetchAuthServerMetadata(
  issuer: string,
  o: { timeout?: number; fetchImpl?: FetchImpl } = {},
): Promise<AuthServerMeta> {
  const url = authorizationServerMetadataUrl(issuer)
  const raw = await getJson(url, { what: "authorization server metadata", timeout: o.timeout, fetchImpl: o.fetchImpl })
  // RFC 8414 §3.3: the declared issuer must be the URL the metadata was fetched for.
  if (raw?.issuer !== issuer)
    throw new McpOAuthError(`authorization server metadata at ${url} declares issuer ${JSON.stringify(raw?.issuer)}, expected ${issuer}`)
  const authorizationEndpoint = typeof raw?.authorization_endpoint === "string" ? raw.authorization_endpoint : undefined
  if (!authorizationEndpoint) throw new McpOAuthError(`authorization server metadata at ${url} has no "authorization_endpoint"`)
  const tokenEndpoint = typeof raw?.token_endpoint === "string" ? raw.token_endpoint : undefined
  if (!tokenEndpoint) throw new McpOAuthError(`authorization server metadata at ${url} has no "token_endpoint"`)
  const methods: unknown[] = Array.isArray(raw?.code_challenge_methods_supported) ? raw.code_challenge_methods_supported : []
  if (!methods.includes("S256"))
    throw new McpOAuthError(`authorization server ${issuer} does not support PKCE S256 (code_challenge_methods_supported: ${JSON.stringify(methods)})`)
  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: typeof raw?.registration_endpoint === "string" ? raw.registration_endpoint : undefined,
    revocationEndpoint: typeof raw?.revocation_endpoint === "string" ? raw.revocation_endpoint : undefined,
    issuerInResponseRequired: raw?.authorization_response_iss_parameter_supported === true,
  }
}
