import { readdirSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import type { ToolDef } from "./registry"

const PAGE = 2000

export function resolveP(p: string, cwd: string) { return isAbsolute(p) ? p : join(cwd, p) }

export const readTool: ToolDef = {
  name: "read",
  description: "Read a file (numbered lines) or list a directory (non-recursive). Use offset/limit for large files.",
  schema: {
    type: "object",
    properties: { path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } },
    required: ["path"],
  },
  permission: "allow",
  async execute(args, ctx) {
    const path = resolveP(args.path, ctx.cwd)
    try {
      const stat = await Bun.file(path).stat()
      if (stat.isDirectory()) {
        const entries = readdirSync(path)
        return { output: entries.join("\n") }
      }
      const buf = new Uint8Array(await Bun.file(path).arrayBuffer())
      if (buf.includes(0)) return { output: `binary file: ${path} (not readable as text)`, error: true }
      const text = new TextDecoder().decode(buf)
      const offset = args.offset ?? 1
      const limit = args.limit ?? PAGE
      const lines = text.split("\n").slice(offset - 1, offset - 1 + limit)
      return { output: lines.map((l, i) => `${offset + i}: ${l}`).join("\n") }
    } catch (e: any) {
      return { output: `read failed: ${e.message}`, error: true }
    }
  },
}
