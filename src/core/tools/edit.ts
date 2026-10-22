import { isAbsolute, join } from "node:path"
import type { ToolDef } from "./registry"
import { unifiedDiff } from "./diff"

export const editTool: ToolDef = {
  name: "edit",
  description: "Replace text in an existing file. oldString must match exactly once unless replaceAll is true.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string" }, oldString: { type: "string" },
      newString: { type: "string" }, replaceAll: { type: "boolean" },
    },
    required: ["path", "oldString", "newString"],
  },
  permission: "ask",
  async execute(args, ctx) {
    const path = isAbsolute(args.path) ? args.path : join(ctx.cwd, args.path)
    try {
      const file = Bun.file(path)
      const text = await file.text()
      const count = text.split(args.oldString).length - 1
      if (count === 0) return { output: `oldString not found in ${path}`, error: true }
      if (count > 1 && !args.replaceAll) {
        return { output: `oldString matches ${count} times in ${path}; provide more context or replaceAll`, error: true }
      }
      const next = args.replaceAll
        ? text.split(args.oldString).join(args.newString)
        : text.replace(args.oldString, args.newString)
      await Bun.write(path, next)
      return { output: unifiedDiff(path, args.oldString, args.newString) }
    } catch (e: any) {
      return { output: `edit failed: ${e.message}`, error: true }
    }
  },
}
