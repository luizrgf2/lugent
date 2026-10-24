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
    if (!e || e.status === "connecting") return
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
    for (const [, e] of this.entries) { e.client?.closeSync(); e.client = undefined }
  }

  private async tryConnect(name: string): Promise<void> {
    const e = this.entries.get(name)!
    e.status = "connecting"
    const r = await connectServer(name, e.cfg, this.projectRoot)
    if (r.ok) { e.client = r.client; e.infos = r.tools; e.status = "connected"; e.error = undefined }
    else { e.client = undefined; e.infos = undefined; e.status = "failed"; e.error = r.error }
  }

  private async disconnect(e: Entry): Promise<void> {
    if (e.client) await e.client.close().catch(() => {})
    e.client = undefined
    e.infos = undefined
  }

  private emit(): void { this.onChange?.(this.tools()) }
}
