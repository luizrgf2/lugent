import { resolve } from "node:path"
import type { McpServerConfig } from "../config"
import { McpClient, type McpToolInfo } from "./client"
import { StdioTransport } from "./stdio"
import { HttpTransport } from "./http"
import type { Transport } from "./transport"
import { McpAuthRequiredError } from "./oauth/errors"
import type { TokenProvider } from "./oauth/session"

export async function connectServer(
  name: string,
  cfg: McpServerConfig,
  projectRoot: string,
  onClient?: (client: McpClient) => void,
  opts: { token?: TokenProvider } = {},
): Promise<{ ok: true; client: McpClient; tools: McpToolInfo[] } | { ok: false; error: string; authRequired?: boolean }> {
  const transport: Transport = cfg.type === "local"
    ? new StdioTransport(cfg.command, { cwd: cfg.cwd ? resolve(projectRoot, cfg.cwd) : projectRoot, env: cfg.environment })
    : new HttpTransport(name, cfg.url, cfg.headers, cfg.timeout, opts.token)
  const client = new McpClient(name, transport, cfg.timeout)
  // Hand the client to the owner before connecting: a child is spawned (and can
  // hang) inside connect(), so the owner must be able to kill it at any point.
  onClient?.(client)
  try {
    await client.connect()
    const tools = await client.listTools()
    return { ok: true, client, tools }
  } catch (e: any) {
    await client.close().catch(() => {})
    return { ok: false, error: e?.message ?? String(e), authRequired: e instanceof McpAuthRequiredError }
  }
}
