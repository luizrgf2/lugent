import type { ChatMsg, Message, SkillMeta } from "./types"

export const SYSTEM_PROMPT = `You are lugent, a coding agent working in the user's terminal.
Explore the codebase with the provided tools before making claims. Prefer minimal, focused changes.
Run tests when they exist. When you finish a task, state what changed and how to verify it.`

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
  const parts: string[] = [input.agentPrompt ?? SYSTEM_PROMPT]
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
