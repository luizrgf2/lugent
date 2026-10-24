import { MCP_TIMEOUT } from "../protocol"
import { McpOAuthError } from "./errors"

/** The one seam every networked module takes, so tests drive the protocol without a TLS server. */
export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

interface Ctx { what: string; timeout?: number; fetchImpl?: FetchImpl }

async function send(url: string, init: RequestInit, o: Ctx): Promise<Response> {
  const timeout = o.timeout ?? MCP_TIMEOUT
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeout)
  try {
    return await (o.fetchImpl ?? fetch)(url, { ...init, signal: ctl.signal })
  } catch (e: any) {
    const why = e?.name === "AbortError" ? `timed out after ${timeout}ms` : e?.message ?? String(e)
    throw new McpOAuthError(`${o.what} request to ${url} failed: ${why}`)
  } finally { clearTimeout(timer) }
}

async function body(res: Response, url: string, o: Ctx): Promise<any> {
  const text = await res.text()
  if (!res.ok) {
    let code: string | undefined
    let description: string | undefined
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed?.error === "string") code = parsed.error
      if (typeof parsed?.error_description === "string") description = parsed.error_description
    } catch { /* not JSON: fall through to the raw text */ }
    throw new McpOAuthError(
      `${o.what} at ${url} answered HTTP ${res.status}${description ? `: ${description}` : text ? `: ${text.slice(0, 200)}` : ""}`,
      code, res.status)
  }
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch { throw new McpOAuthError(`${o.what} at ${url} did not return JSON`) }
}

export async function getJson(url: string, o: Ctx): Promise<any> {
  const res = await send(url, { headers: { accept: "application/json" } }, o)
  return body(res, url, o)
}

export async function postJson(url: string, payload: unknown, o: Ctx): Promise<any> {
  const res = await send(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  }, o)
  return body(res, url, o)
}

export async function postForm(url: string, form: Record<string, string>, o: Ctx): Promise<any> {
  const res = await send(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  }, o)
  return body(res, url, o)
}
