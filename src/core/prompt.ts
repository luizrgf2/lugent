import type { ChatMsg, Message, SkillMeta } from "./types"

export const SYSTEM_PROMPT = `You are lugent, a coding agent working in the user's terminal.
Explore the codebase with the provided tools before making claims. Prefer minimal, focused changes.
Run tests when they exist. When you finish a task, state what changed and how to verify it.`

// Always the first part of the prefix, and deliberately NOT part of SYSTEM_PROMPT:
// an agent's prompt replaces SYSTEM_PROMPT, so MCP knowledge living there would
// vanish under `plan` or any user-defined agent. Kept short and unconditional —
// it must reach a user who has no server configured, since that is exactly the
// user who asks how to add one. If this grows into a procedure, move it to a
// built-in skill (see docs/decisions.md).
const MCP_SECTION = `# MCP

lugent speaks the Model Context Protocol (MCP) to external tool servers, declared in the \`mcp\` map of a lugent.json:
- project: <cwd>/lugent.json — merged with the global file, project wins per server
- global: ~/.config/lugent/config.json
Shape (\`type\` is inferred from \`command\`/\`url\`; \`http\` is an alias for \`remote\`):
  "mcp": {
    "local-one": { "type": "local", "command": ["npx", "-y", "some-mcp@latest"] },
    "remote-one": { "type": "remote", "url": "https://host/mcp", "headers": { "X-Tenant": "{env:TENANT}" } }
  }
Optional keys: \`environment\` and \`cwd\` (local), \`headers\` (remote), \`enabled: false\`, \`timeout\` in ms (default 30000); \`environment\`/\`headers\` values support \`{env:VAR}\`.
A connected server's tools appear as \`<server>_<tool>\` and ask for permission by default. \`/mcp\` lists servers (connected/failed/disabled) and can reconnect, disable or enable one — session-only, it never rewrites the config; config edits take effect on the next start.
Only when I ask you to install a server: edit that file with write/edit (they ask first), keep tokens as \`{env:VAR}\` — never inline a secret, especially in a project file that may be committed — then tell me to restart.`

export interface PromptInput {
  cwd: string
  os: string
  gitBranch: string | null
  date: string
  agentsMd: string | null
  skills: SkillMeta[]
  tools: { name: string; description: string; schema: unknown }[]
  agentPrompt?: string   // set when a session agent is selected: replaces SYSTEM_PROMPT
}

export function buildPrefix(input: PromptInput): string {
  const parts: string[] = [MCP_SECTION, input.agentPrompt ?? SYSTEM_PROMPT]
  const env = [`Environment:`, `- cwd: ${input.cwd}`, `- os: ${input.os}`,
    `- git branch: ${input.gitBranch ?? "(none)"}`, `- date: ${input.date}`]
  parts.push(env.join("\n"))
  if (input.agentsMd) parts.push(`# Project instructions (AGENTS.md)\n\n${input.agentsMd}`)
  if (input.skills.length > 0) {
    parts.push("# Skills\n\n" + input.skills.map(s => `- ${s.id}: ${s.name} — ${s.description}`).join("\n"))
  }
  parts.push("# Tools\n\n" + input.tools.map(t => `- ${t.name}: ${t.description}`).join("\n"))
  return parts.join("\n\n")
}

export function buildMessages(prefix: string, history: Message[], lastUserContent?: import("./types").UserContent): ChatMsg[] {
  const msgs: ChatMsg[] = [{ role: "system", content: prefix }]
  let pendingUser = lastUserContent   // only the newest user message carries expanded parts
  const tail: ChatMsg[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user" && pendingUser !== undefined) {
      tail.unshift({ role: "user", content: pendingUser })
      pendingUser = undefined
      continue
    }
    tail.unshift(toChatMsg(history[i]))
  }
  return [...msgs, ...tail]
}

function toChatMsg(m: Message): ChatMsg {
  if (m.role === "user") return { role: "user", content: m.content ?? "" }
  if (m.role === "assistant") return {
    role: "assistant", content: m.content,
    tool_calls: m.toolCalls?.map(tc => ({
      id: tc.id, type: "function" as const,
      function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
    })),
  }
  return { role: "tool", tool_call_id: m.toolCallId, content: m.content ?? "" }
}
