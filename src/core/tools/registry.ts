import type { ToolContext, ToolResult } from "../types"

export interface ToolDef {
  name: string
  description: string
  schema: { type: "object"; properties: Record<string, { type: string }>; required?: string[] }
  permission: "allow" | "ask"
  execute(args: any, ctx: ToolContext): Promise<ToolResult>
}

// ponytail: minimal checker (string/number/boolean only) — swap for a real JSON
// Schema validator when a tool needs nested types.
export function validateArgs(args: unknown, schema: ToolDef["schema"]): string | null {
  if (typeof args !== "object" || args === null) return "args must be an object"
  for (const k of schema.required ?? []) {
    if (!(k in (args as object))) return `missing required field: ${k}`
  }
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    const p = schema.properties[k]
    if (p && p.type && p.type !== typeof v) {
      return `field ${k}: expected ${p.type}, got ${typeof v}`
    }
  }
  return null
}
