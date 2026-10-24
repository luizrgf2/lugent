import type { ToolContext, ToolResult } from "../types"

/** Raw JSON Schema floated by the provider; MCP servers supply arbitrary shapes. */
export interface JsonSchema {
  type: "object"
  properties?: Record<string, unknown>
  required?: string[]
  [k: string]: unknown
}

export interface ToolDef {
  name: string
  description: string
  schema: JsonSchema
  permission: "allow" | "ask"
  execute(args: any, ctx: ToolContext): Promise<ToolResult>
}

// ponytail: top-level only (required presence + primitive types). An MCP schema's
// nested properties are the server's contract — leaving them unchecked is correct,
// a false rejection is worse than a passthrough.
export function validateArgs(args: unknown, schema: JsonSchema): string | null {
  if (typeof args !== "object" || args === null) return "args must be an object"
  for (const k of schema.required ?? []) {
    if (!(k in (args as object))) return `missing required field: ${k}`
  }
  const props = schema.properties ?? {}
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    const p = props[k] as { type?: string } | undefined
    if (p?.type === "string" || p?.type === "number" || p?.type === "boolean") {
      if (typeof v !== p.type) return `field ${k}: expected ${p.type}, got ${typeof v}`
    }
  }
  return null
}
