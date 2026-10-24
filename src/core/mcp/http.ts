import { parseSSE } from "../provider"
import type { JsonRpcId, JsonRpcMessage } from "./protocol"
import { MCP_TIMEOUT, isRequest, isResponse } from "./protocol"
import type { Transport, TransportHandlers } from "./transport"

/** Raised on 401: the Phase 2 OAuth hook. No turn ever opens a browser. */
export class McpAuthError extends Error {
  constructor(public server: string, public wwwAuthenticate?: string) {
    super(`server ${server} requires OAuth authorization — run "/mcp auth ${server}"`)
  }
}

export class McpHttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`)
  }
}

/** Streamable HTTP, legacy request/response path: one POST per JSON-RPC message. */
export class HttpTransport implements Transport {
  private handlers?: TransportHandlers
  private sessionId?: string
  private protocolVersion?: string
  private initId?: JsonRpcId
  private closed = false

  constructor(private server: string, private url: string, private headers: Record<string, string> = {}, private timeout = MCP_TIMEOUT) {}

  async start(handlers: TransportHandlers): Promise<void> { this.handlers = handlers }

  async send(msg: JsonRpcMessage): Promise<void> {
    if (this.closed) throw new Error(`server ${this.server} is not connected`)
    if (isRequest(msg) && msg.method === "initialize") this.initId = msg.id
    const res = await this.post(msg)
    if (res.status === 401) throw new McpAuthError(this.server, res.headers.get("www-authenticate") ?? undefined)
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
    if (isResponse(m)) {
      if (this.initId !== undefined && m.id === this.initId) {
        const pv = (m as any).result?.protocolVersion
        if (typeof pv === "string") this.protocolVersion = pv
        this.initId = undefined
      }
    }
    this.handlers?.onMessage(m)
  }

  private post(msg: JsonRpcMessage): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.headers,
    }
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
