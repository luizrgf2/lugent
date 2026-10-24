import type { ToolDef } from "../tools/registry"
import type { McpClient, McpToolInfo } from "./client"

/** Provider function names allow [A-Za-z0-9_-] and cap at 64 chars. */
export function sanitizeToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 64)
}

/**
 * Bridges MCP tools into lugent ToolDefs. MCP servers are untrusted third
 * parties, so every call defaults to "ask" (an agent may allow/deny by name).
 * `taken` is shared across servers so a name collision drops the later tool.
 */
export function mcpToolDefs(
  server: string,
  client: McpClient,
  tools: McpToolInfo[],
  taken = new Set<string>(),
): { tools: ToolDef[]; skipped: string[] } {
  const out: ToolDef[] = []
  const skipped: string[] = []
  for (const t of tools) {
    const name = sanitizeToolName(`${server}_${t.name}`)
    if (taken.has(name)) {
      skipped.push(name)
      console.warn(`mcp: tool name collision "${name}" — dropped`)
      continue
    }
    taken.add(name)
    out.push({
      name,
      description: t.description || `MCP tool ${t.name} from ${server}`,
      schema: (t.inputSchema as any) ?? { type: "object", properties: {} },
      permission: "ask",
      execute: (args) => client.callTool(t.name, args),
    })
  }
  return { tools: out, skipped }
}
