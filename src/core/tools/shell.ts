import type { ToolDef } from "./registry"
import { shellCommand } from "../platform"

export const shellTool: ToolDef = {
  name: "shell",
  description: "Execute a shell command (bash on unix, cmd on Windows). Default timeout 2 minutes. background: true for long-running processes.",
  schema: {
    type: "object",
    properties: {
      command: { type: "string" }, workdir: { type: "string" },
      timeout: { type: "number" }, background: { type: "boolean" },
    },
    required: ["command"],
  },
  permission: "ask",
  async execute(args, ctx) {
    try {
      const proc = Bun.spawn([...shellCommand(process.platform), args.command], {
        cwd: args.workdir ?? ctx.cwd,
        stdout: "pipe", stderr: "pipe", stdin: "ignore",
      })
      if (args.background) {
        return { output: `background: started (pid ${proc.pid}) — output not captured in v1` }
      }
      const timeout = args.timeout ?? 120_000
      let killed = false
      const timer = setTimeout(() => { killed = true; proc.kill() }, timeout)
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const code = await proc.exited
      clearTimeout(timer)
      if (killed) return { output: `timed out after ${timeout}ms (process killed)\n${out}`.trim(), error: true }
      const text = (out + (err ? `\n(stderr)\n${err}` : "")).trim()
      if (code !== 0) return { output: `exit code ${code}\n${text}`, error: true }
      return { output: text || "(no output)" }
    } catch (e: any) {
      return { output: `shell failed: ${e.message}`, error: true }
    }
  },
}
