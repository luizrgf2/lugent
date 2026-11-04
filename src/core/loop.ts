import { randomUUID } from "node:crypto"
import type { Store } from "./store"
import type { Agent, ChatResponse, Message, ToolContext, ToolResult } from "./types"
import type { ToolDef } from "./tools/registry"
import { validateArgs } from "./tools/registry"
import { buildPrefix, buildMessages, type PromptInput } from "./prompt"
import { checkPermission, resourceFor } from "./permissions"
import { toolsForAgent, canBeSubagent, agentModelTarget } from "./agents"
import type { AppConfig } from "./config"
import { expandImages } from "./images"

const TRUNCATE = 10_000
const MAX_TOOL_ROUNDS = 50

export interface SubagentStreamItem {
  kind: "assistant" | "reasoning" | "tool"
  text: string
  tool?: string
}

export interface LoopDeps {
  store: Store
  provider: { chat(args: any): Promise<ChatResponse> }
  tools: ToolDef[]
  promptInput: PromptInput
  signal: AbortSignal
  onToken?: (t: string) => void
  onReasoning?: (t: string) => void
  onRetry?: (info: { attempt: number; delayMs: number; error: string }) => void
  onToolStart?: (name: string, resource: string) => void
  onAsk: (tool: string, resource: string) => Promise<"y" | "n" | "a">
  yolo?: boolean   // auto-approve every tool call, including outside-project ones
  agent?: Agent    // selected agent: filters the toolset, overrides permission defaults
  agents?: Agent[] // launchable catalog; also enables the subagent tool's spawn
  config?: AppConfig
  /** Builds the provider for a child whose agent pins a model; the child inherits the parent's otherwise. */
  providerFor?: (provider: string, model: string) => { chat(args: any): Promise<ChatResponse> }
  /** Child-aware stream hooks (TUI): every child is keyed by its session id,
   *  so parallel children never cross-talk. Only the CLI layer consumes them. */
  onSubagentStart?: (childSessionId: string, agentId: string) => void
  onSubagentEvent?: (childSessionId: string, item: SubagentStreamItem) => void
  onSubagentEnd?: (childSessionId: string) => void
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

function buildSpawn(deps: LoopDeps, parentId: string): NonNullable<ToolContext["spawn"]> {
  return async (agentId, prompt) => {
    const child = (deps.agents ?? []).find(a => a.id === agentId)
    if (!child) return { output: `unknown subagent: ${agentId}`, error: true } satisfies ToolResult
    if (!canBeSubagent(child)) return { output: `agent ${agentId} is not a subagent (mode: primary)`, error: true } satisfies ToolResult

    const parent = deps.store.loadSession(parentId)
    const target = agentModelTarget(child, deps.config?.providers ?? {})
    let provider = deps.provider
    if (target) {
      const built = deps.providerFor?.(target.provider, target.model)
      if (!built) return { output: `no provider configured for ${target.provider}/${target.model}`, error: true } satisfies ToolResult
      provider = built
    }

    // Depth 1: the child never gets the subagent tool, so it cannot spawn a grandchild.
    const childTools = toolsForAgent(deps.tools, child).filter(t => t.name !== "subagent")
    const childInput: PromptInput = {
      ...deps.promptInput,
      agentPrompt: child.prompt,
      tools: childTools.map(t => ({ name: t.name, description: t.description, schema: t.schema })),
      skills: childTools.some(t => t.name === "skill") ? deps.promptInput.skills : [],
      subagents: [],
    }
    const childId = deps.store.createSession(
      target?.provider ?? parent?.provider ?? "",
      target?.model ?? parent?.model ?? "",
      deps.promptInput.cwd, child.id, parentId).id

    deps.onSubagentStart?.(childId, agentId)
    // The child streams into the parent's subagent hooks (keyed by childId, so
    // parallel children are independent). Text accumulates per round — reset
    // when the child's next provider round starts — mirroring what the parent
    // transcript shows for its own turn (one assistant item per round).
    let answer = ""
    let reasoning = ""
    const childChat = (args: any) => { answer = ""; reasoning = ""; return provider.chat(args) }
    try {
      const r = await runTurn({
        ...deps, provider: { chat: childChat }, tools: childTools, promptInput: childInput, agent: child,
        onToken: t => { answer += t; deps.onSubagentEvent?.(childId, { kind: "assistant", text: answer }) },
        onReasoning: t => { reasoning += t; deps.onSubagentEvent?.(childId, { kind: "reasoning", text: reasoning }) },
        onToolStart: (name, resource) => deps.onSubagentEvent?.(childId, { kind: "tool", tool: name, text: resource }),
      }, childId, prompt, deps.promptInput.cwd)

      if (r.aborted) return { output: `subagent ${agentId} aborted`, error: true } satisfies ToolResult
      const last = [...deps.store.getMessages(childId)].reverse().find(m => m.role === "assistant" && m.content)
      if (!last?.content) return { output: `subagent ${agentId} produced no answer${r.error ? `: ${r.error}` : ""}`, error: true } satisfies ToolResult
      return { output: last.content } satisfies ToolResult
    } finally {
      deps.onSubagentEnd?.(childId)
    }
  }
}

export async function runTurn(deps: LoopDeps, sessionId: string, userText: string, cwd = process.cwd()): Promise<{ aborted: boolean; error?: string }> {
  const { store } = deps
  const tools = toolsForAgent(deps.tools, deps.agent)
  const spawn = deps.agents ? buildSpawn(deps, sessionId) : undefined
  store.appendMessage(msg({ sessionId, role: "user", content: userText }))
  const userContent = expandImages(userText, cwd)

  while (true) {
    const prefix = buildPrefix(deps.promptInput)
    const history = cleanHistory(store.getMessages(sessionId))
    let res: ChatResponse
    try {
      res = await deps.provider.chat({
        messages: buildMessages(prefix, history, userContent),
        tools: tools,
        signal: deps.signal,
        onToken: deps.onToken,
        onReasoning: deps.onReasoning,
        onRetry: deps.onRetry,
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
      const tool = tools.find(t => t.name === call.name)
      if (!tool) {
        store.appendMessage(msg({ sessionId, role: "tool", content: `unknown tool: ${call.name}`, toolCallId: call.id }))
        return
      }
      const resource = resourceFor(call)
      const decision = deps.yolo ? "allow"
        : isOutsideProject(resource, deps.promptInput.cwd)
          ? (store.hasPermission(sessionId, tool.name, resource) ? "allow" : "ask")
          : checkPermission(store, sessionId, tool, resource, deps.agent)
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
        result = await tool.execute(call.args, { cwd: deps.promptInput.cwd, signal: deps.signal, spawn })
      } catch (e: any) {
        result = { output: `tool error: ${e.message}`, error: true }
      }
      store.appendMessage(msg({ sessionId, role: "tool", content: truncate(result.output), toolCallId: call.id }))
    }))
  }
}
