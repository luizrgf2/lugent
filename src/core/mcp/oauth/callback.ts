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

/** Inline SVG glyphs — an emoji or an icon font would need no asset either, but these inherit `currentColor`. */
const ICON = {
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4.5"/><path d="M12 16h.01"/></svg>`,
} as const

/**
 * Inline CSS on purpose: the browser that lands here may be offline and `src/core`
 * is dependency-free, so the page must render with no external asset — no CDN, no
 * web font, no image. Dark by default (it is a terminal tool), auto-switching to
 * light from `prefers-color-scheme`; `color-scheme` keeps the browser chrome in step.
 */
const STYLE = `
:root { color-scheme: dark light; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; padding: 2rem; display: grid; place-items: center;
  background: #0d1117; color: #e6edf3; line-height: 1.5; -webkit-font-smoothing: antialiased;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.card { width: 100%; max-width: 26rem; padding: 2.25rem 2rem; text-align: center;
  background: #161b22; border: 1px solid #30363d; border-radius: 14px; }
.brand { margin: 0 0 1.75rem; color: #8b949e; font-size: 0.7rem; font-weight: 600;
  letter-spacing: 0.2em; text-transform: uppercase;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.icon { width: 3rem; height: 3rem; margin: 0 auto 1.25rem; display: grid; place-items: center; border-radius: 50%; }
.icon svg { width: 1.75rem; height: 1.75rem; }
.icon.success { background: rgba(63,185,80,0.14); color: #3fb950; }
.icon.error { background: rgba(248,81,73,0.14); color: #f85149; }
h1 { margin: 0 0 0.75rem; font-size: 1.25rem; font-weight: 600; }
p { margin: 0 0 0.75rem; color: #8b949e; }
p:last-child { margin-bottom: 0; }
.hint { font-size: 0.85rem; }
/* The raw protocol string (error / error_description), unlike lugent's own prose. */
.message { color: #e6edf3; font-size: 0.9rem; word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.server { padding: 0.1rem 0.45rem; border-radius: 6px; color: #e6edf3; font-size: 0.9em;
  background: #21262d; border: 1px solid #30363d;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
@media (prefers-color-scheme: light) {
  body { background: #f6f8fa; color: #1f2328; }
  .card { background: #fff; border-color: #d0d7de; }
  .brand, p { color: #59636e; }
  .message { color: #1f2328; }
  .server { color: #1f2328; background: #f6f8fa; border-color: #d0d7de; }
  .icon.success { background: rgba(26,127,55,0.12); color: #1a7f37; }
  .icon.error { background: rgba(207,34,46,0.12); color: #cf222e; }
}
`

function page(o: { title: string; kind: "success" | "error"; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="card">
<p class="brand">lugent · mcp</p>
<div class="icon ${o.kind}">${ICON[o.kind]}</div>
<h1>${o.title}</h1>
${o.body}
</main>
</body>
</html>`
}

export function successPage(serverName: string): string {
  return page({
    title: "Authorization complete",
    kind: "success",
    body: `<p><span class="server">${escapeHtml(serverName)}</span> is connected to lugent.</p>`
      + `<p class="hint">You can close this tab and go back to your terminal.</p>`,
  })
}

export function errorPage(message: string): string {
  return page({
    title: "Authorization failed",
    kind: "error",
    body: `<p class="message">${escapeHtml(message)}</p>`
      + `<p class="hint">You can close this tab and try again from lugent.</p>`,
  })
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
