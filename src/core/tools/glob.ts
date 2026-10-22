import { isAbsolute, join } from "node:path"
import type { ToolDef } from "./registry"

export const globTool: ToolDef = {
  name: "glob",
  description: "Find file paths matching a glob pattern (e.g. **/*.ts). Limit 100.",
  schema: {
    type: "object",
    properties: { pattern: { type: "string" }, path: { type: "string" }, limit: { type: "number" } },
    required: ["pattern"],
  },
  permission: "allow",
  async execute(args, ctx) {
    const base = args.path ? (isAbsolute(args.path) ? args.path : join(ctx.cwd, args.path)) : ctx.cwd
    const files = Array.from(new Bun.Glob(args.pattern).scanSync({ cwd: base, onlyFiles: true }))
      .slice(0, args.limit ?? 100)
    return { output: files.length ? files.join("\n") : "(no matches)" }
  },
}
