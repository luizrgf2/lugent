import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { McpOAuthError } from "./errors"

/** < 49152 keeps the port out of the ephemeral range the OS hands to outbound sockets. */
export const OAUTH_CALLBACK_PORT = 48762
export const OAUTH_CALLBACK_PATH = "/oauth/callback"
export const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

export function redirectUri(port = OAUTH_CALLBACK_PORT): string {
  return `http://127.0.0.1:${port}${OAUTH_CALLBACK_PATH}`
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui;margin:3rem;line-height:1.5"><h1>${title}</h1>${body}</body></html>`
}

export function successPage(serverName: string): string {
  return page("Authorization complete",
    `<p><strong>${escapeHtml(serverName)}</strong> is connected to lugent.</p><p>You can close this tab and go back to your terminal.</p>`)
}

export function errorPage(message: string): string {
  return page("Authorization failed",
    `<p>${escapeHtml(message)}</p><p>You can close this tab and try again from lugent.</p>`)
}

export interface CallbackResult { code: string; iss?: string }

export interface CallbackServer {
  redirectUri: string
  /** Settles on the first accepted callback; rejects on an error response, a timeout or close(). */
  result: Promise<CallbackResult>
  close(): void
}

export async function startCallbackServer(o: {
  state: string
  serverName: string
  port?: number
  timeoutMs?: number
}): Promise<CallbackServer> {
  const port = o.port ?? OAUTH_CALLBACK_PORT
  const timeoutMs = o.timeoutMs ?? CALLBACK_TIMEOUT_MS
  let done = false
  let settle!: { resolve(r: CallbackResult): void; reject(e: Error): void }
  const result = new Promise<CallbackResult>((resolve, reject) => { settle = { resolve, reject } })

  const finish = (fn: () => void) => {
    if (done) return
    done = true
    clearTimeout(timer)
    server.close()
    ;(server as any).closeAllConnections?.()
    fn()
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`)
    const html = (status: number, body: string, after?: () => void) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" })
      res.end(body, after)
    }
    if (url.pathname !== OAUTH_CALLBACK_PATH || done) return html(404, errorPage("not found"))
    const q = url.searchParams
    // State first: a forged or replayed callback must change nothing at all.
    if (q.get("state") !== o.state) return html(400, errorPage("invalid or expired state parameter"))
    const err = q.get("error")
    if (err) {
      const description = q.get("error_description")
      const msg = description ? `${err}: ${description}` : err
      html(200, errorPage(msg), () => finish(() => settle.reject(new McpOAuthError(`authorization was refused: ${msg}`))))
      return
    }
    const code = q.get("code")
    if (!code) return html(400, errorPage("the authorization response carried no code"))
    html(200, successPage(o.serverName), () => finish(() => settle.resolve({ code, iss: q.get("iss") ?? undefined })))
  })

  const timer = setTimeout(
    () => finish(() => settle.reject(new McpOAuthError(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser to authorize`))),
    timeoutMs)

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", (e: NodeJS.ErrnoException) => {
        reject(e.code === "EADDRINUSE"
          ? new McpOAuthError(`port ${port} is already in use — close whatever holds it (another lugent?) and try again`)
          : e)
      })
      server.listen(port, "127.0.0.1", resolve)
    })
  } catch (e) {
    clearTimeout(timer)
    throw e
  }

  const bound = (server.address() as AddressInfo).port
  return { redirectUri: redirectUri(bound), result, close: () => finish(() => settle.reject(new McpOAuthError("authorization cancelled"))) }
}
