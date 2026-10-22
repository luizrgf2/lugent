import { randomUUID } from "node:crypto"
import type { Store } from "./store"
import type { ChatResponse, Message } from "./types"
import type { ToolDef } from "./tools/registry"
import { validateArgs } from "./tools/registry"
import { buildPrefix, buildMessages, type PromptInput } from "./prompt"
import { checkPermission, resourceFor } from "./permissions"

const TRUNCATE = 10_000

export interface LoopDeps {
  store: Store
  provider: { chat(args: any): Promise<ChatResponse> }
  tools: ToolDef[]
  promptInput: PromptInput
  signal: AbortSignal
  onToken?: (t: string) => void
  onToolStart?: (name: string, resource: string) => void
  onAsk: (tool: string, resource: string) => Promise<"y" | "n" | "a">
}

function msg(partial: Partial<Message> & { sessionId: string; role: Message["role"] }): Message {
  return { id: `msg_${randomUUID()}`, createdAt: new Date().toISOString(), content: null, ...partial } as Message
}

function truncate(s: string): string {
  return s.length > TRUNCATE ? s.slice(0, TRUNCATE) + `\n…(truncated ${s.length - TRUNCATE} chars)` : s
}

/** Normalize history after abort/crash: strip unanswered tool_calls, drop orphaned results. */
function cleanHistory(history: Message[]): Message[] {
  const answered = new Set(history.filter(m => m.role === "tool").map(m => m.toolCallId))
  const droppedCallIds = new Set<string>()
  const cleaned = history.flatMap(m => {
    if (m.role !== "assistant" || !m.toolCalls) return [m]
    if (m.toolCalls.every(tc => answered.has(tc.id))) return [m]
    const kept = m.toolCalls.filter(tc => answered.has(tc.id))
    for (const tc of m.toolCalls) if (!kept.includes(tc)) droppedCallIds.add(tc.id)
    if (kept.length === 0 && !m.content) return []                  // nothing survives: drop message
    return [{ ...m, toolCalls: kept.length ? kept : undefined }]    // keep text + answered calls only
  })
  return cleaned.filter(m => !(m.role === "tool" && m.toolCallId && droppedCallIds.has(m.toolCallId)))
}

/** ponytail: pattern-level escape check (absolute, .., ~) — symlink escapes need real path audit later. */
function isOutsideProject(resource: string, cwd: string): boolean {
  if (resource.startsWith("~") || resource.includes("..")) return true
  if (!resource.startsWith("/")) return false
  const rel = resource.startsWith(cwd + "/") || resource === cwd
  return !rel
}

export async function runTurn(deps: LoopDeps, sessionId: string, userText: string): Promise<{ aborted: boolean; error?: string }> {
  const { store } = deps
  store.appendMessage(msg({ sessionId, role: "user", content: userText }))

  while (true) {
    const prefix = buildPrefix(deps.promptInput)
    const history = cleanHistory(store.getMessages(sessionId))
    let res: ChatResponse
    try {
      res = await deps.provider.chat({
        messages: buildMessages(prefix, history),
        tools: deps.tools,
        signal: deps.signal,
        onToken: deps.onToken,
      })
    } catch (e: any) {
      if (deps.signal.aborted) {
        store.setAborted(sessionId)
        return { aborted: true }
      }
      return { aborted: false, error: `provider error: ${e.message}` }
    }

    if (res.toolCalls.length === 0) {
      store.appendMessage(msg({
        sessionId, role: "assistant", content: res.content,
        meta: res.usage ? { usage: res.usage } : undefined,
      }))
      return { aborted: false }
    }

    store.appendMessage(msg({ sessionId, role: "assistant", content: res.content || null, toolCalls: res.toolCalls }))

    if (deps.signal.aborted) {
      store.setAborted(sessionId)
      return { aborted: true }   // do not start pending calls; cleanHistory defends next turn
    }

    await Promise.all(res.toolCalls.map(async call => {
      const tool = deps.tools.find(t => t.name === call.name)
      if (!tool) {
        store.appendMessage(msg({ sessionId, role: "tool", content: `unknown tool: ${call.name}`, toolCallId: call.id }))
        return
      }
      const resource = resourceFor(call)
      const decision = isOutsideProject(resource, deps.promptInput.cwd)
        ? (store.hasPermission(sessionId, tool.name, resource) ? "allow" : "ask")
        : checkPermission(store, sessionId, tool, resource)
      if (decision === "ask") {
        const answer = await deps.onAsk(call.name, resource)
        if (answer === "a") store.grantPermission(sessionId, tool.name, resource)
        if (answer === "n") {
          store.appendMessage(msg({ sessionId, role: "tool", content: `permission denied for ${call.name}`, toolCallId: call.id }))
          return
        }
      }
      const invalid = validateArgs(call.args, tool.schema)
      if (invalid) {
        store.appendMessage(msg({ sessionId, role: "tool", content: `invalid arguments: ${invalid}`, toolCallId: call.id }))
        return
      }
      deps.onToolStart?.(call.name, resource)
      let result
      try {
        result = await tool.execute(call.args, { cwd: deps.promptInput.cwd, signal: deps.signal })
      } catch (e: any) {
        result = { output: `tool error: ${e.message}`, error: true }
      }
      store.appendMessage(msg({ sessionId, role: "tool", content: truncate(result.output), toolCallId: call.id }))
    }))
  }
}
