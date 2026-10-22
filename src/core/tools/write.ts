import { mkdir } from "node:fs/promises"
import { isAbsolute, join, dirname } from "node:path"
import type { ToolDef } from "./registry"

export const writeTool: ToolDef = {
  name: "write",
  description: "Create or completely replace a text file. Creates parent directories.",
  schema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  permission: "ask",
  async execute(args, ctx) {
    const path = isAbsolute(args.path) ? args.path : join(ctx.cwd, args.path)
    try {
      await mkdir(dirname(path), { recursive: true })
      await Bun.write(path, args.content)
      return { output: `wrote ${path} (${args.content.length} chars)` }
    } catch (e: any) {
      return { output: `write failed: ${e.message}`, error: true }
    }
  },
}
