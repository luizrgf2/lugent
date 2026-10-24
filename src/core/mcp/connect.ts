import { resolve } from "node:path"
import type { McpServerConfig } from "../config"
import { McpClient, type McpToolInfo } from "./client"
import { StdioTransport } from "./stdio"
import { HttpTransport } from "./http"
import type { Transport } from "./transport"

export async function connectServer(
  name: string,
  cfg: McpServerConfig,
  projectRoot: string,
): Promise<{ ok: true; client: McpClient; tools: McpToolInfo[] } | { ok: false; error: string }> {
  const transport: Transport = cfg.type === "local"
    ? new StdioTransport(cfg.command, { cwd: cfg.cwd ? resolve(projectRoot, cfg.cwd) : projectRoot, env: cfg.environment })
    : new HttpTransport(name, cfg.url, cfg.headers, cfg.timeout)
  const client = new McpClient(name, transport, cfg.timeout)
  try {
    await client.connect()
    const tools = await client.listTools()
    return { ok: true, client, tools }
  } catch (e: any) {
    await client.close().catch(() => {})
    return { ok: false, error: e?.message ?? String(e) }
  }
}
