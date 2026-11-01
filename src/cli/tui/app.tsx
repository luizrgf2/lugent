import { useEffect, useRef, useState } from "react"
import { Box, Text, render, useApp, useInput, useStdout } from "ink"
import type { ReplEnv } from "../repl"
import type { Agent } from "../../core/types"
import { Provider } from "../../core/provider"
import { runTurn } from "../../core/loop"
import { toolsForAgent, agentModelTarget, resolveAgent } from "../../core/agents"
import { buildPromptInput, safeAgentsMd } from "../context"
import { frameRows, logoTopPad, transcriptWindow } from "../logo"
import { ContextLine, LogoMark } from "./status"
import { Transcript, clampItems, itemLines, itemsFromHistory, type TItem } from "./transcript"
import { Input } from "./input"
import { Permissions } from "./permissions"
import { ModelPicker } from "./model-picker"
import { AgentPicker } from "./agent-picker"
import { SkillList } from "./skill-list"
import { PermissionMode } from "./permission-mode"
import { SessionPicker } from "./session-picker"
import { McpList } from "./mcp-list"
import { createMouseStdin, MOUSE_ON, MOUSE_OFF } from "./mouse"
import type { McpServerState } from "../../core/mcp/manager"

export type TuiEnv = ReplEnv & {
  offProviders: string[]
  makeProvider?: (cfg: any, model: string) => { chat(args: any): Promise<any> }
}

function patchTail(items: TItem[], item: TItem): TItem[] {
  return items.length && items[items.length - 1].kind === item.kind
    ? [...items.slice(0, -1), item]
    : [...items, item]
}

export function App(props: { env: TuiEnv; onWheel?: (fn: (d: number) => void) => () => void }) {
  const { exit } = useApp()
  const env = props.env
  const [items, setItems] = useState<TItem[]>([])
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<{ tool: string; resource: string; resolve(a: "y" | "n" | "a"): void } | null>(null)
  // Ref mirrors state: ink batches keys into one render, so a useInput closure
  // reading the sigint state can see a stale value (same hazard as input.tsx).
  const sigintRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  // Transcript scroll: skipBottom lines hidden below the window; 0 = follow tail.
  // PageUp/Down move it; submit resets to 0. While scrolled, streaming growth
  // is compensated by bumping scroll with the same delta so the view stays put.
  const [scroll, setScroll] = useState(0)
  const scrollRef = useRef(0)
  // The loop runs tool calls in parallel; several can require permission at
  // once. A bare setAsk keeps only the last dialog and loses the first
  // resolve → Promise.all never settles → turn hangs. Queue asks instead.
  const askChainRef = useRef<Promise<void>>(Promise.resolve())
  const askRef = useRef<{ tool: string; resource: string; resolve(a: "y" | "n" | "a"): void } | null>(null)
  const [abort, setAbort] = useState<AbortController | null>(null)
  const [agent, setAgentState] = useState<Agent | undefined>(() => resolveAgent(env.agents, env.config.defaultAgent))
  const [session, setSession] = useState(() => env.store.createSession(env.config.defaultProvider, env.config.defaultModel, env.projectRoot, agent?.id ?? null))
  // A defaultAgent's model (when its provider is configured) wins over the config default at startup.
  const [provider, setProvider] = useState(() => agentModelTarget(agent, env.config.providers)?.provider ?? env.config.defaultProvider)
  const [model, setModel] = useState(() => agentModelTarget(agent, env.config.providers)?.model ?? env.config.defaultModel)
  const [overlay, setOverlay] = useState<null | "model" | "skills" | "resume" | "permissions" | "agent" | "mcp">(null)
  const overlayRef = useRef<null | "model" | "skills" | "resume" | "permissions" | "agent" | "mcp">(null)
  const [mcpStates, setMcpStates] = useState<McpServerState[]>([])
  /** Set while /mcp authenticate waits for the browser, so ctrl+c can cancel it. */
  const authAbortRef = useRef<AbortController | null>(null)
  const [yolo, setYolo] = useState(false)
  const [retry, setRetry] = useState("")
  // Ref mirrors state: submit reads it — ink batching can make state stale.
  const yoloRef = useRef(false)
  const { stdout } = useStdout()

  const closeOverlay = () => { overlayRef.current = null; setOverlay(null) }

  // Mouse wheel (see mouse.ts): three lines per notch — the usual pager step; a
  // full page per notch would feel like it jumps. Ignored while an overlay or a
  // permission dialog owns the input.
  const WHEEL_LINES = 3
  useEffect(() => {
    if (!props.onWheel) return
    return props.onWheel(d => {
      if (overlayRef.current || askRef.current) return
      scrollRef.current = Math.max(0, scrollRef.current - d * WHEEL_LINES)
      setScroll(scrollRef.current)
    })
  }, [props.onWheel])

  // page size = the visible transcript window (same formula as clampItems:
  // chrome below + the LogoMark block above), so one PageUp scrolls exactly a page.
  // pad is 0 here: scrolling only moves anything once an item exists, and the
  // splash pad is 0 from the first item on (same value the region gets below).
  const budget = () => transcriptWindow((stdout as any)?.rows ?? 24, 0)

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      // A sign-in waiting for the browser is cancelled first: it must not count
      // toward the double-ctrl+c exit, and it must not abort the turn.
      if (authAbortRef.current) { authAbortRef.current.abort(); authAbortRef.current = null; return }
      if (overlayRef.current) { closeOverlay(); return }   // overlay open: ctrl+c just closes it
      const n = sigintRef.current + 1
      sigintRef.current = n
      if (n === 1) {
        abortRef.current?.abort()
        askRef.current?.resolve("n")   // deny pending permission so the turn can unwind
        askRef.current = null
        setAsk(null)
      } else {
        exit()
      }
      return
    }
    if (overlayRef.current || ask) return   // overlays/dialogs own the keys
    if (key.pageUp) { scrollRef.current += budget(); setScroll(scrollRef.current); return }
    if (key.pageDown) { scrollRef.current = Math.max(0, scrollRef.current - budget()); setScroll(scrollRef.current) }
    // Keyboard-only scroll (no PageUp key on many keyboards):
    // shift+up/down = page up/down, home = top, end = tail. plain up/down/left/right stay untouched.
    else if (key.shift && key.upArrow) { scrollRef.current += budget(); setScroll(scrollRef.current); return }
    else if (key.shift && key.downArrow) { scrollRef.current = Math.max(0, scrollRef.current - budget()); setScroll(scrollRef.current); return }
    else if (key.home) { scrollRef.current = 1e9; setScroll(scrollRef.current); return }
    else if (key.end) { scrollRef.current = 0; setScroll(0); return }
  })

  async function submit(text: string) {
    sigintRef.current = 0   // new turn: single ctrl+c aborts again, doesn't exit
    scrollRef.current = 0   // new turn: jump back to the tail
    setScroll(0)
    setItems(is => [...is, { kind: "user", text }])
    if (text.startsWith("/")) {
      if (text.trim() === "/exit") return exit()
      if (text.trim() === "/model") { overlayRef.current = "model"; setOverlay("model"); return }
      if (text.trim() === "/skills") { overlayRef.current = "skills"; setOverlay("skills"); return }
      if (text.trim() === "/mcp") {
        if (!busy) { setMcpStates(env.mcp.states()); overlayRef.current = "mcp"; setOverlay("mcp") }
        return
      }
      if (text.trim() === "/permissions") {
        if (!busy) { overlayRef.current = "permissions"; setOverlay("permissions") }
        return
      }
      if (text.trim() === "/agent") {
        if (!busy) { overlayRef.current = "agent"; setOverlay("agent") }
        return
      }
      if (text.trim() === "/resume") {
        if (!busy) { overlayRef.current = "resume"; setOverlay("resume") }
        return
      }
      setItems(is => [...is, { kind: "error", text: `${text} — use --plain mode for slash commands in v1` }])
      return
    }
    const cfg = env.config.providers[provider]
    if (!cfg) {
      setItems(is => [...is, { kind: "error", text: "no provider configured (lugent.json)" }])
      return
    }
    const ac = new AbortController()
    abortRef.current = ac
    setAbort(ac)
    setBusy(true)
    let reasoning = ""
    let answer = ""
    let seen = 0      // lines already counted for the streaming tail item (scroll pin)
    let seenIdx = -1  // index the count belongs to; a new item starts from 0 (+ gap line)
    const grow = (patch: (is: TItem[]) => TItem[]) => setItems(is => {
      const next = patch(is)
      const tail = next[next.length - 1]
      if (!tail) return next
      const idx = next.length - 1
      const now = itemLines(tail) + (idx > 0 ? 1 : 0)   // separator gap counts as a line
      const delta = now - (seenIdx === idx ? seen : 0)
      seen = now
      seenIdx = idx
      if (delta > 0 && scrollRef.current > 0) { scrollRef.current += delta; setScroll(scrollRef.current) }
      return next
    })
    const chatProvider = env.makeProvider?.(cfg, model) ?? new Provider(cfg, model)
    // runTurn re-calls provider.chat once per tool round; each round streams only
    // its own text, so the accumulators must reset or the transcript repeats
    // every earlier round prefixed into the next one.
    const chat = (args: any) => { reasoning = ""; answer = ""; seen = 0; seenIdx = -1; return chatProvider.chat(args) }
    const r = await runTurn({
      store: env.store,
      provider: { chat },
      tools: env.tools,
      promptInput: buildPromptInput(env, model, agent),
      signal: ac.signal,
      yolo: yoloRef.current,
      agent,
      onReasoning: t => { reasoning += t; grow(is => patchTail(is, { kind: "reasoning", text: reasoning })) },
      onToken: t => { answer += t; setRetry(""); grow(is => patchTail(is, { kind: "assistant", text: answer })) },
      onRetry: i => setRetry(`attempt ${i.attempt} failed — ${i.error} · retrying in ${Math.round(i.delayMs / 1000)}s`),
      onToolStart: (name, resource) => setItems(is => [...is, { kind: "tool", tool: name, text: resource }]),
      onAsk: (tool, resource) => new Promise(resolve => {
        askChainRef.current = askChainRef.current.then(() => new Promise<void>(release => {
          if (abortRef.current?.signal.aborted) { resolve("n"); release(); return }
          askRef.current = { tool, resource, resolve: a => { resolve(a); release() } }
          setAsk(askRef.current)
        }))
      }),
    }, session.id, text, env.projectRoot)
      .catch((e: any) => ({ aborted: false, error: `internal error: ${e?.message ?? e}` }))   // never leave the spinner stuck with no message
    setBusy(false)
    setRetry("")
    abortRef.current = null
    setAbort(null)
    setAsk(null)
    if (r.error) setItems(is => [...is, { kind: "error", text: r.error! }])
  }

  // ink resolves height="100%" to auto — constrain manually from real rows.
  // The splash pad is 0 as soon as there is any item, so the window only loses
  // rows to the padding while the transcript is empty (see logoTopPad).
  const rows = (stdout as any)?.rows ?? 24
  const pad = items.length === 0 ? logoTopPad(rows) : 0
  const window = transcriptWindow(rows, pad)
  const visible = clampItems(items, window, scroll)
  const agentsMd = safeAgentsMd(env.projectRoot)
  return (
    // Root pinned to the viewport (minus one row, see frameRows): every region
    // below the transcript is a fixed block, so the transcript is the only one
    // that can give — sized from its content instead, a page of scroll or a
    // wrapped long line changed the frame height and shifted the composer.
    <Box flexDirection="column" flexShrink={0} height={frameRows(rows)}>
      <LogoMark topPad={pad} />
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} justifyContent="flex-end" overflowY="hidden">
        <Transcript items={visible} />
      </Box>
      {/* Chrome: everything below the transcript in one flexShrink={0} block, so
          the transcript is what absorbs the slack (last child would otherwise
          be the one squeezed when the content is taller than the viewport). */}
      <Box flexDirection="column" flexShrink={0}>
      {retry && <Text color="yellow">{retry}</Text>}
      <ContextLine agent={agent} agentsMd={agentsMd} yolo={yolo} off={env.offProviders.includes(provider)} model={`${provider} · ${model}`} busy={busy && !ask} />
      {overlay === "agent"        ? <AgentPicker
            agents={env.agents}
            current={agent?.id}
            onClose={closeOverlay}
            onPick={a => {
              closeOverlay()
              setAgentState(a)
              env.store.setAgent(session.id, a.id)
              const target = agentModelTarget(a, env.config.providers)
              if (target) {
                setProvider(target.provider)
                setModel(target.model)
              }
              setItems(is => [...is, { kind: "system", text: `agent ${a.id}${target ? ` · ${target.provider}/${target.model}` : ""} · tools: ${toolsForAgent(env.tools, a).map(t => t.name).join(",") || "none"}` }])
            }} />
        : overlay === "model"
        ? <ModelPicker
            providers={Object.keys(env.config.providers)}
            currentProvider={provider}
            currentModel={model}
            loadModels={prov => {
              const cfg = env.config.providers[prov]
              if (!cfg) return Promise.resolve([])
              const pr = env.makeProvider?.(cfg, model) ?? new Provider(cfg, model)
              return (pr as any).listModels()
            }}
            onPick={(prov, m) => {
              closeOverlay()
              setProvider(prov)
              setModel(m)
              setItems(is => [...is, { kind: "system", text: `${prov} · ${m}` }])
            }}
            onClose={closeOverlay} />
        : overlay === "skills"
          ? <SkillList skills={env.skills} onClose={closeOverlay} />
          : overlay === "mcp"
            ? <McpList
                states={mcpStates}
                onAction={async (name, action, onUrl) => {
                  if (action === "authenticate") {
                    const ctl = new AbortController()
                    authAbortRef.current = ctl
                    try { await env.mcp.authenticate(name, { onUrl, signal: ctl.signal }) }
                    finally { authAbortRef.current = null }
                  } else if (action === "logout") await env.mcp.logout(name)
                  else if (action === "reconnect") await env.mcp.reconnect(name)
                  else if (action === "disable") await env.mcp.disable(name)
                  else await env.mcp.enable(name)
                  setMcpStates(env.mcp.states())
                }}
                onClose={closeOverlay} />
          : overlay === "resume"
            ? <SessionPicker
                sessions={env.store.listSessions(env.projectRoot)}
                onClose={closeOverlay}
                onPick={id => {
                  closeOverlay()
                  if (id === session.id) return
                  const row = env.store.loadSession(id)
                  if (!row) return
                  setSession({ ...row, id })
                  const nextAgent = row.agent ? env.agents.find(a => a.id === row.agent) : undefined
                  setAgentState(nextAgent)
                  const target = agentModelTarget(nextAgent, env.config.providers)
                  if (target) { setProvider(target.provider); setModel(target.model) }
                  else {
                    setProvider(row.provider)
                    if (row.model) setModel(row.model)
                  }
                  setItems(itemsFromHistory(env.store.getMessages(id)).map(it =>
                    it.kind === "assistant" ? { ...it, kind: "system" } : it))
                }} />
          : overlay === "permissions"
            ? <PermissionMode
                current={yolo ? "yolo" : "normal"}
                onPick={m => {
                  closeOverlay()
                  yoloRef.current = m === "yolo"
                  setYolo(m === "yolo")
                  setItems(is => [...is, { kind: "system", text: m === "yolo" ? "permission mode: yolo (auto-approve)" : "permission mode: normal" }])
                }}
                onClose={closeOverlay} />
          : ask
            ? <Permissions tool={ask.tool} resource={ask.resource} onAnswer={a => { askRef.current = null; ask.resolve(a); setAsk(null) }} />
            : <Input
                disabled={busy}
                onSubmit={submit}
                completions={[
                  { cmd: "exit", desc: "quit lugent" },
                  { cmd: "model", desc: "switch provider/model" },
                  { cmd: "skills", desc: "browse skills" },
                  { cmd: "mcp", desc: "MCP servers (status/reconnect)" },
                  { cmd: "resume", desc: "resume a past session" },
                  { cmd: "permissions", desc: "permission mode (normal/yolo)" },
                  { cmd: "agent", desc: "switch agent profile" },
                ]} />}
      </Box>
      {/* spinner lives inside ContextLine now — one chrome line, always visible */}
    </Box>
  )
}

export function runTui(env: TuiEnv, io: { stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream } = {}): Promise<void> {
  // Ink paints its first frame below whatever is already on screen and only
  // clears when a previous frame exists, so the shell prompt + startup lines
  // would sit above the TUI. Erase the visible viewport (home + erase-down —
  // scrollback stays intact) before the first render.
  const stdin = io.stdin ?? process.stdin
  const stdout = io.stdout ?? process.stdout
  stdout.write("\x1b[H\x1b[J")
  // Mouse wheel: ink has no mouse support, so reports are stripped off stdin by
  // a proxy and turned into scroll deltas (see mouse.ts). Reporting is switched
  // on around the session and restored on the way out — leaving 1000/1006 on
  // would break text selection in the user's shell.
  const mouse = createMouseStdin(stdin)
  stdout.write(MOUSE_ON)
  const restore = () => { stdout.write(MOUSE_OFF); mouse.close() }
  process.on("exit", restore)
  const inst = render(<App env={env} onWheel={mouse.onWheel} />, { exitOnCtrlC: false, stdin: mouse.stdin as any, stdout })
  return inst.waitUntilExit().finally(() => {
    process.off("exit", restore)
    restore()
  })
}
