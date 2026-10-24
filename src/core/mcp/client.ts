import type { ToolResult } from "../types"
import type { JsonRpcId, JsonRpcMessage } from "./protocol"
import {
  CLIENT_NAME, CLIENT_VERSION, CLIENT_PROTOCOL_VERSION, MCP_TIMEOUT,
  SUPPORTED_PROTOCOL_VERSIONS, isError, isResponse,
} from "./protocol"
import type { Transport, TransportHandlers } from "./transport"

export interface McpToolInfo { name: string; description?: string; inputSchema?: unknown }

interface Pending { resolve(v: any): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }

/** Transport-agnostic MCP client: id counter, pending map, timeouts, handshake. */
export class McpClient {
  private id = 0
  private pending = new Map<JsonRpcId, Pending>()
  private closed = false
  private protocolVersion = CLIENT_PROTOCOL_VERSION
  /** Fires when the transport dies on its own (not from our close()) so the owner can flip the server to failed. */
  onClosed?: (err: Error) => void

  constructor(private name: string, private transport: Transport, private timeout = MCP_TIMEOUT) {}

  async connect(): Promise<{ protocolVersion: string; serverInfo: unknown }> {
    const died = (err: Error) => {
      if (this.closed) return   // our own close(): not a crash
      this.closed = true
      this.failAll(err)
      this.onClosed?.(err)
    }
    const handlers: TransportHandlers = {
      onMessage: m => this.onMessage(m),
      onError: e => died(e),
      onClose: () => died(new Error(`server ${this.name} closed the connection`)),
    }
    await this.transport.start(handlers)
    const res: any = await this.request("initialize", {
      protocolVersion: CLIENT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
    })
    if (typeof res?.protocolVersion === "string") this.protocolVersion = res.protocolVersion
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(this.protocolVersion))
      console.warn(`mcp ${this.name}: server protocol version ${this.protocolVersion} is not in the supported set`)
    await this.notify("notifications/initialized")
    return { protocolVersion: this.protocolVersion, serverInfo: res?.serverInfo }
  }

  async listTools(): Promise<McpToolInfo[]> {
    const out: McpToolInfo[] = []
    let cursor: string | undefined
    do {
      const res: any = await this.request("tools/list", cursor ? { cursor } : {})
      for (const t of res?.tools ?? [])
        if (t && typeof t.name === "string") out.push({ name: t.name, description: t.description, inputSchema: t.inputSchema })
      cursor = typeof res?.nextCursor === "string" ? res.nextCursor : undefined
    } while (cursor)
    return out
  }

  async callTool(name: string, args: unknown): Promise<ToolResult> {
    const res: any = await this.request("tools/call", { name, arguments: args })
    const content: any[] = Array.isArray(res?.content) ? res.content : []
    const parts = content.filter(c => c?.type === "text" && typeof c.text === "string").map(c => c.text as string)
    const other = content.filter(c => c?.type !== "text").map(c => `[${c?.type ?? "unknown"}]`)
    const output = [...parts, ...other].join("\n")
    return { output: output || "(no output)", error: res?.isError === true }
  }

  private request(method: string, params?: unknown): Promise<any> {
    if (this.closed) return Promise.reject(new Error(`server ${this.name} is not connected`))
    const id = ++this.id
    const p = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`request ${method} timed out after ${this.timeout}ms`))
      }, this.timeout)
      this.pending.set(id, { resolve, reject, timer })
    })
    this.transport.send({ jsonrpc: "2.0", id, method, params }).catch(e => {
      const entry = this.pending.get(id)
      if (entry) { clearTimeout(entry.timer); this.pending.delete(id); entry.reject(e) }
    })
    return p
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) throw new Error(`server ${this.name} is not connected`)
    await this.transport.send({ jsonrpc: "2.0", method, params })
  }

  private onMessage(m: JsonRpcMessage): void {
    if (!isResponse(m)) return
    const entry = this.pending.get(m.id)
    if (!entry) return
    this.pending.delete(m.id)
    clearTimeout(entry.timer)
    if (isError(m)) entry.reject(new Error(m.error.message))
    else entry.resolve(m.result)
  }

  private failAll(err: Error): void {
    for (const [, e] of this.pending) { clearTimeout(e.timer); e.reject(err) }
    this.pending.clear()
  }

  async close(): Promise<void> {
    this.closed = true
    await this.transport.close()
    this.failAll(new Error(`server ${this.name} is not connected`))
  }

  closeSync(): void {
    this.closed = true
    this.transport.closeSync()
    this.failAll(new Error(`server ${this.name} is not connected`))
  }

  /** test seam: drive an arbitrary method to exercise error mapping */
  requestForTest(method: string, params?: unknown): Promise<any> { return this.request(method, params) }

  /** True once the client is closed or the transport has died. */
  get isClosed(): boolean { return this.closed }
}
