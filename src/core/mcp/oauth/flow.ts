import { CLIENT_NAME, CLIENT_PROTOCOL_VERSION, CLIENT_VERSION, MCP_TIMEOUT } from "../protocol"
import { openBrowserCommand } from "../../platform"
import { McpOAuthError } from "./errors"
import { challengeFor, createState, createVerifier } from "./pkce"
import { getEntry, putEntry, removeEntry } from "./store"
import { startCallbackServer } from "./callback"
import { exchangeCode } from "./token"
import { registerClient } from "./register"
import { fetchAuthServerMetadata, fetchProtectedResource, parseWwwAuthenticate } from "./discovery"
import type { FetchImpl } from "./request"

export interface AuthenticateOptions {
  name: string
  serverUrl: string
  storePath: string
  scopes?: string[]
  /** 0 lets the OS choose (tests); the default is the fixed OAUTH_CALLBACK_PORT. */
  port?: number
  timeout?: number
  signal?: AbortSignal
  fetchImpl?: FetchImpl
  /** Called with the consent URL, for a terminal that wants to print it. */
  onUrl?: (url: string) => void
  /** Defaults to the platform's browser opener; tests inject a fake. */
  openBrowser?: (url: string) => void | Promise<void>
}

export async function authenticate(o: AuthenticateOptions): Promise<void> {
  const timeout = o.timeout ?? MCP_TIMEOUT
  const challenge = await probeChallenge(o.serverUrl, { timeout, fetchImpl: o.fetchImpl })
  const prmUrl = parseWwwAuthenticate(challenge)
  if (!prmUrl) throw new McpOAuthError(`server ${o.serverUrl} answered 401 without a resource_metadata parameter — it does not advertise OAuth discovery`)

  const prm = await fetchProtectedResource(prmUrl, { timeout, fetchImpl: o.fetchImpl })
  const meta = await fetchAuthServerMetadata(prm.authorizationServers[0], { timeout, fetchImpl: o.fetchImpl })
  if (!meta.registrationEndpoint) throw new McpOAuthError(`authorization server ${meta.issuer} offers no dynamic client registration (RFC 7591)`)

  const state = createState()
  const server = await startCallbackServer({ state, serverName: o.name, port: o.port })
  const onAbort = () => server.close()
  o.signal?.addEventListener("abort", onAbort, { once: true })
  try {
    const cached = getEntry(o.storePath, o.name, o.serverUrl)
    const clientId = cached && cached.issuer === meta.issuer
      ? cached.clientId
      : (await registerClient({ registrationEndpoint: meta.registrationEndpoint, redirectUri: server.redirectUri, scopes: o.scopes, timeout, fetchImpl: o.fetchImpl })).clientId

    const verifier = createVerifier()
    const url = new URL(meta.authorizationEndpoint)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", clientId)
    url.searchParams.set("redirect_uri", server.redirectUri)
    url.searchParams.set("state", state)
    url.searchParams.set("code_challenge", challengeFor(verifier))
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("resource", prm.resource)
    // No scopes configured: send no scope at all — the consent screen decides.
    if (o.scopes?.length) url.searchParams.set("scope", o.scopes.join(" "))
    o.onUrl?.(url.toString())
    await openInBrowser(url.toString(), o.openBrowser)

    const { code, iss } = await server.result
    if (iss !== undefined && iss !== meta.issuer)
      throw new McpOAuthError(`the authorization response came from ${iss}, expected ${meta.issuer}`)
    if (meta.issuerInResponseRequired && iss === undefined)
      throw new McpOAuthError(`authorization server ${meta.issuer} requires an "iss" parameter and the response had none`)

    const tokens = await exchangeCode({
      tokenEndpoint: meta.tokenEndpoint, code, redirectUri: server.redirectUri,
      clientId, codeVerifier: verifier, resource: prm.resource, timeout, fetchImpl: o.fetchImpl,
    }).catch((e: unknown) => {
      // The code is bound to the client that requested it, so a rejected client_id
      // cannot be retried here — drop the cached registration and say so.
      if (e instanceof McpOAuthError && e.code === "invalid_client") {
        removeEntry(o.storePath, o.name)
        throw new McpOAuthError(`${e.message} — the cached client registration was rejected and discarded; run authenticate again`, e.code, e.status)
      }
      throw e
    })

    putEntry(o.storePath, o.name, {
      serverUrl: o.serverUrl, resource: prm.resource, issuer: meta.issuer, clientId,
      tokenEndpoint: meta.tokenEndpoint, revocationEndpoint: meta.revocationEndpoint, tokens,
    })
  } finally {
    o.signal?.removeEventListener("abort", onAbort)
    server.close()
  }
}

/** One unauthenticated initialize: 401 means "OAuth", 2xx means "you do not need this". */
async function probeChallenge(serverUrl: string, o: { timeout: number; fetchImpl?: FetchImpl }): Promise<string | undefined> {
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: CLIENT_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION } },
  })
  let res: Response
  try {
    res = await (o.fetchImpl ?? fetch)(serverUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body,
      signal: AbortSignal.timeout(o.timeout),
    })
  } catch (e: any) {
    throw new McpOAuthError(`could not reach ${serverUrl}: ${e?.name === "TimeoutError" ? `timed out after ${o.timeout}ms` : e?.message ?? String(e)}`)
  }
  if (res.status !== 401) throw new McpOAuthError(`server ${serverUrl} answered HTTP ${res.status} instead of 401 — it does not require OAuth authorization`)
  return res.headers.get("www-authenticate") ?? undefined
}

async function openInBrowser(url: string, impl?: (url: string) => void | Promise<void>): Promise<void> {
  if (impl) { await impl(url); return }
  try {
    Bun.spawn(openBrowserCommand(process.platform, url), { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref()
  } catch { /* the URL was already handed to the caller: a missing opener is not fatal */ }
}
