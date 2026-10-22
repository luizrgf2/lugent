import { isAbsolute, join } from "node:path"
import type { ToolDef } from "./registry"

export const grepTool: ToolDef = {
  name: "grep",
  description: "Search file contents. Returns path:line:preview per match. Limit 100.",
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string" }, path: { type: "string" },
      literal: { type: "boolean" }, limit: { type: "number" },
    },
    required: ["pattern"],
  },
  permission: "allow",
  async execute(args, ctx) {
    const base = args.path ? (isAbsolute(args.path) ? args.path : join(ctx.cwd, args.path)) : ctx.cwd
    const re = args.literal ? new RegExp(String(args.pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : new RegExp(args.pattern)
    const limit = args.limit ?? 100
    const out: string[] = []
    const files = Array.from(new Bun.Glob("**/*").scanSync({ cwd: base, onlyFiles: true }))
    for (const f of files) {
      const buf = new Uint8Array(await Bun.file(join(base, f)).arrayBuffer())
      if (buf.includes(0)) continue                       // skip binary
      const lines = new TextDecoder().decode(buf).split("\n")
      for (let i = 0; i < lines.length && out.length < limit; i++) {
        if (re.test(lines[i])) out.push(`${f}:${i + 1}:${lines[i].trim().slice(0, 120)}`)
      }
      if (out.length >= limit) break
    }
    return { output: out.length ? out.join("\n") : "(no matches)" }
  },
}
