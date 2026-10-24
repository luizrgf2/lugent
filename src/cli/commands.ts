import type { McpServerState, McpServerStatus } from "../core/mcp/manager"

export function parseSlash(input: string): { cmd: string; args: string[] } | null {
  if (!input.startsWith("/")) return null
  const [cmd, ...args] = input.slice(1).trim().split(/\s+/)
  return { cmd, args }
}

/** Permission prompt answer: only explicit y/a allows — everything else denies (F3). */
export function parseAnswer(answer: string): "y" | "n" | "a" {
  const c = answer.trim().toLowerCase()
  if (c === "a" || c === "always") return "a"
  if (c === "y" || c === "yes") return "y"
  return "n"
}

export type McpAction = "authenticate" | "logout" | "reconnect" | "disable" | "enable"

/** The actions a row offers, by status — the single source for REPL and TUI. */
export function mcpActions(status: McpServerStatus, type: "local" | "remote"): McpAction[] {
  // logout is meaningless for a spawned child: only a remote server has a token.
  if (status === "connected") return type === "remote" ? ["logout", "disable"] : ["disable"]
  if (status === "disabled") return ["enable"]
  if (status === "auth_required") return ["authenticate", "disable"]
  return ["reconnect", "disable"]   // failed, or mid-connect
}

export function formatMcpState(s: McpServerState): string {
  const base = `${s.name} (${s.type}) — ${s.status}`
  if (s.status === "connected") return `${base}, ${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`
  if (s.status === "auth_required") return s.error ? `${base}: needs authentication — ${s.error}` : `${base}: needs authentication`
  if (s.error) return `${base}: ${s.error}`
  return base
}
