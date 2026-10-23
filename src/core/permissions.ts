import type { Store } from "./store"
import type { ToolCall, Agent } from "./types"
import type { ToolDef } from "./tools/registry"
import { effectivePermission } from "./agents"

export type Decision = "allow" | "ask"

export function resourceFor(call: ToolCall): string {
  const a = (call.args ?? {}) as Record<string, unknown>
  if (typeof a.path === "string") return a.path
  if (typeof a.command === "string") return a.command
  if (typeof a.id === "string") return a.id
  return "*"
}

export function checkPermission(store: Store, sessionId: string, tool: ToolDef, resource: string, agent?: Agent): Decision {
  if (store.hasPermission(sessionId, tool.name, resource)) return "allow"
  return effectivePermission(tool, agent)
}
