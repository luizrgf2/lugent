import type { McpServerConfig, McpServerConfigMap } from "../config"
import type { ToolDef } from "../tools/registry"
import { connectServer } from "./connect"
import type { McpClient, McpToolInfo } from "./client"
import { mcpToolDefs } from "./tools"

export type McpServerStatus = "connected" | "failed" | "disabled" | "connecting"

export interface McpServerState {
  name: string
  type: "local" | "remote"
  status: McpServerStatus
  error?: string
  toolCount: number
}

interface Entry {
  cfg: McpServerConfig
  status: McpServerStatus
  error?: string
  client?: McpClient
  infos?: McpToolInfo[]
}

/**
 * Runtime owner of the MCP servers. Startup connects everything in parallel and
 * isolates failures; `/mcp` drives reconnect/disable/enable. Tool defs are
 * rebuilt on every `tools()` call so name collisions resolve across whatever set
 * is currently active.
 */
export class McpManager {
  private entries = new Map<string, Entry>()
  /** Clients not yet attached to an entry (a spawn that can still be hanging) — closeSync must reach these too. */
  private inflight = new Set<McpClient>()
  /** Names with a connect attempt in flight, so two reconnects cannot race. */
  private connecting = new Set<string>()
  onChange?: (tools: ToolDef[]) => void

  constructor(config: McpServerConfigMap, private projectRoot: string) {
    for (const [name, cfg] of Object.entries(config))
      this.entries.set(name, { cfg, status: cfg.enabled === false ? "disabled" : "connecting" })
  }

  async connectAll(): Promise<void> {
    await Promise.all([...this.entries].filter(([, e]) => e.cfg.enabled !== false).map(([name]) => this.tryConnect(name)))
    this.emit()
  }

  async reconnect(name: string): Promise<void> {
    const e = this.entries.get(name)
    if (!e) return
    await this.disconnect(e)
    await this.tryConnect(name)
    this.emit()
  }

  async disable(name: string): Promise<void> {
    const e = this.entries.get(name)
    if (!e) return
    await this.disconnect(e)
    e.status = "disabled"
    e.error = undefined
    this.emit()
  }

  async enable(name: string): Promise<void> {
    const e = this.entries.get(name)
    // Never reconnect a server that is already up (or on its way): tryConnect
    // would drop the live client without closing it.
    if (!e || e.status === "connecting" || e.status === "connected") return
    await this.tryConnect(name)
    this.emit()
  }

  states(): McpServerState[] {
    return [...this.entries].map(([name, e]) => ({
      name,
      type: e.cfg.type === "local" ? "local" : "remote",
      status: e.status,
      error: e.error,
      toolCount: e.infos?.length ?? 0,
    }))
  }

  tools(): ToolDef[] {
    const taken = new Set<string>()
    const out: ToolDef[] = []
    for (const [name, e] of this.entries) {
      if (e.status !== "connected" || !e.client) continue
      out.push(...mcpToolDefs(name, e.client, e.infos ?? [], taken).tools)
    }
    return out
  }

  closeSync(): void {
    for (const c of this.inflight) c.closeSync()
    this.inflight.clear()
    for (const [, e] of this.entries) { e.client?.closeSync(); e.client = undefined }
  }

  private async tryConnect(name: string): Promise<void> {
    // One attempt per server at a time: a second concurrent reconnect would
    // spawn a child that only the last client keeps a handle to.
    if (this.connecting.has(name)) return
    this.connecting.add(name)
    try {
      const e = this.entries.get(name)!
      e.status = "connecting"
      let pending: McpClient | undefined
      // connectServer never throws — it returns a result — so the handle is
      // always released here, even when the server spawns and then hangs.
      const r = await connectServer(name, e.cfg, this.projectRoot, c => { pending = c; this.inflight.add(c) })
      if (pending) this.inflight.delete(pending)
      if (r.ok && !r.client.isClosed) {
        this.watch(r.client, e)
        e.client = r.client
        e.infos = r.tools
        e.status = "connected"
        e.error = undefined
      } else {
        const why = r.ok ? "server closed during startup" : r.error
        if (r.ok) r.client.closeSync()
        e.client = undefined
        e.infos = undefined
        e.status = "failed"
        e.error = why
      }
    } finally {
      this.connecting.delete(name)
    }
  }

  /** A server that dies on its own is no longer connected: flip it to failed so /mcp offers reconnect. */
  private watch(client: McpClient, e: Entry): void {
    client.onClosed = err => {
      if (e.client !== client) return   // already replaced/disabled
      e.client = undefined
      e.infos = undefined
      e.status = "failed"
      e.error = err.message
      this.emit()
    }
  }

  private async disconnect(e: Entry): Promise<void> {
    if (e.client) await e.client.close().catch(() => {})
    e.client = undefined
    e.infos = undefined
  }

  private emit(): void { this.onChange?.(this.tools()) }
}
