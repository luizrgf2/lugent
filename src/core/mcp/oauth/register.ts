import { postJson, type FetchImpl } from "./request"
import { McpOAuthError } from "./errors"

/** RFC 7591 dynamic registration for a public client: no secret, PKCE instead. */
export async function registerClient(o: {
  registrationEndpoint: string
  redirectUri: string
  scopes?: string[]
  timeout?: number
  fetchImpl?: FetchImpl
}): Promise<{ clientId: string }> {
  const payload: Record<string, unknown> = {
    redirect_uris: [o.redirectUri],
    client_name: "lugent",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }
  if (o.scopes?.length) payload.scope = o.scopes.join(" ")
  const raw = await postJson(o.registrationEndpoint, payload, { what: "dynamic client registration", timeout: o.timeout, fetchImpl: o.fetchImpl })
  if (typeof raw?.client_id !== "string" || !raw.client_id)
    throw new McpOAuthError(`dynamic client registration at ${o.registrationEndpoint} returned no "client_id"`)
  return { clientId: raw.client_id }
}
