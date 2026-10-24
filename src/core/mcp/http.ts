import { parseSSE } from "../provider"
import type { JsonRpcId, JsonRpcMessage } from "./protocol"
import { CLIENT_PROTOCOL_VERSION, MCP_TIMEOUT, isRequest, isResponse } from "./protocol"
import type { Transport, TransportHandlers } from "./transport"
import { McpAuthRequiredError } from "./oauth/errors"
import type { TokenProvider } from "./oauth/session"

export class McpHttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`)
    this.name = "McpHttpError"
  }
}

/** Streamable HTTP, legacy request/response path: one POST per JSON-RPC message. */
export class HttpTransport implements Transport {
  private handlers?: TransportHandlers
  private sessionId?: string
  private protocolVersion?: string
  private initId?: JsonRpcId
  private closed = false

  constructor(
    private server: string,
    private url: string,
    private headers: Record<string, string> = {},
    private timeout = MCP_TIMEOUT,
    private tokens?: TokenProvider,
  ) {}

  async start(handlers: TransportHandlers): Promise<void> { this.handlers = handlers }

  async send(msg: JsonRpcMessage): Promise<void> {
    if (this.closed) throw new Error(`server ${this.server} is not connected`)
    if (isRequest(msg) && msg.method === "initialize") this.initId = msg.id
    // Asked per send, so a refresh between two messages is picked up.
    let token = await this.tokens?.()
    let res = await this.post(msg, token)
    if (res.status === 401 && this.tokens && token) {
      // The server rejected a token our clock thought was good (revoked or rotated).
      // Refresh once, then give up loudly instead of looping.
      const forced = await this.tokens({ force: true })
      if (forced && forced !== token) { token = forced; res = await this.post(msg, token) }
    }
    if (res.status === 401) throw new McpAuthRequiredError(this.server)
    const sid = res.headers.get("mcp-session-id")
    if (sid) this.sessionId = sid
    if (res.status === 202) return
    if (!res.ok) throw new McpHttpError(res.status, await res.text())

    const ct = res.headers.get("content-type") ?? ""
    if (ct.includes("text/event-stream")) {
      for await (const m of parseSSE(res, this.timeout)) this.deliver(m)
      return
    }
    const text = await res.text()
    if (text.trim()) this.deliver(JSON.parse(text))
  }

  private deliver(m: JsonRpcMessage): void {
    if (isResponse(m) && this.initId !== undefined && m.id === this.initId) {
      const pv = (m as any).result?.protocolVersion
      // Spec requires the header on every post-initialize request; if a server
      // omits it in the result we keep sending the revision we asked for.
      this.protocolVersion = typeof pv === "string" ? pv : CLIENT_PROTOCOL_VERSION
      this.initId = undefined
    }
    this.handlers?.onMessage(m)
  }

  private post(msg: JsonRpcMessage, token?: string): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.headers,
    }
    if (token) headers.authorization = `Bearer ${token}`   // an OAuth token beats a static header
    if (this.protocolVersion) headers["mcp-protocol-version"] = this.protocolVersion
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)
    return fetch(this.url, { method: "POST", headers, body: JSON.stringify(msg), signal: controller.signal })
      .catch((e: any) => {
        throw new Error(e?.name === "AbortError"
          ? `request to ${this.url} timed out after ${this.timeout}ms`
          : `request to ${this.url} failed: ${e?.message ?? e}`)
      })
      .finally(() => clearTimeout(timer))
  }

  async close(): Promise<void> { this.closed = true }
  closeSync(): void { this.closed = true }
}
