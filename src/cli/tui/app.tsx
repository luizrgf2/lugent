import { useEffect, useRef, useState } from "react"
import { Box, Text, Static, render, useApp, useInput, useStdout } from "ink"
import type { ReplEnv } from "../repl"
import type { Agent } from "../../core/types"
import { Provider } from "../../core/provider"
import { runTurn } from "../../core/loop"
import { savePermissionMode, globalConfigPath } from "../../core/config"
import { toolsForAgent, agentActivationModel, resolveAgent, primaryAgents } from "../../core/agents"
import { buildPromptInput, safeAgentsMd } from "../context"
import { frameRows, logoTopPad, splashWindow, transcriptWindow, CHROME_HEIGHT } from "../logo"
import { ContextLine, LogoMark } from "./status"
import { Transcript, TranscriptItem, clampItems, itemsFromHistory, type TItem } from "./transcript"
import { Input } from "./input"
import { Permissions } from "./permissions"
import { ModelPicker } from "./model-picker"
import { AgentPicker } from "./agent-picker"
import { SkillList } from "./skill-list"
import { PermissionMode } from "./permission-mode"
import { SessionPicker } from "./session-picker"
import { McpList } from "./mcp-list"
import { ChildViewer, ChildPicker, decorateSubagents, type ChildInfo } from "./child-viewer"
import { truncate } from "../ui"
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

export function App(props: { env: TuiEnv; globalConfigPath?: string }) {
  const { exit } = useApp()
  const env = props.env
  // items = finalized turns (rendered once via <Static> into the terminal's own
  // scrollback — the wheel and text selection scroll it natively, no mouse
  // tracking needed). live = the turn in progress, kept in the fixed frame.
  // The first static item is the logo: printed once at the top of the
  // conversation, never re-rendered by the frame (a frame-pinned logo showed
  // up between history and every new turn, forever).
  const [items, setItems] = useState<TItem[]>([{ kind: "logo", text: "" }])
  const [live, setLive] = useState<TItem[]>([])
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<{ tool: string; resource: string; resolve(a: "y" | "n" | "a"): void } | null>(null)
  // Ref mirrors state: ink batches keys into one render, so a useInput closure
  // reading the sigint state can see a stale value (same hazard as input.tsx).
  const sigintRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  // Live-window scroll: skipBottom lines hidden below the frame's window; 0 =
  // follow the tail. Only the current turn lives in the frame, so a page of
  // scroll is all there is to revisit — older history is the scrollback's job.
  // Refs mirror the scroll state: streaming growth is compensated by the same
  // delta so a view pinned mid-stream stays put while new lines arrive below.
  const scrollRef = useRef(0)
  const seenRef = useRef({ idx: -1, lines: 0 })
  // The loop runs tool calls in parallel; several can require permission at
  // once. A bare setAsk keeps only the last dialog and loses the first
  // resolve → Promise.all never settles → turn hangs. Queue asks instead.
  const askChainRef = useRef<Promise<void>>(Promise.resolve())
  const askRef = useRef<{ tool: string; resource: string; resolve(a: "y" | "n" | "a"): void } | null>(null)
  const [abort, setAbort] = useState<AbortController | null>(null)
  const initialAgent = resolveAgent(env.agents, env.config.defaultAgent)
  // A defaultAgent whose declared model cannot be honored kills the process
  // before the first render — an agent that pins a model runs on it or not at all.
  const startupTarget = agentActivationModel(initialAgent, env.config.providers)
  if ("fatal" in startupTarget) { console.error(startupTarget.fatal); process.exit(1) }
  const [agent, setAgentState] = useState<Agent | undefined>(initialAgent)
  const [session, setSession] = useState(() => env.store.createSession(env.config.defaultProvider, env.config.defaultModel, env.projectRoot, agent?.id ?? null))
  // A defaultAgent's model (when its provider is configured) wins over the config default at startup.
  const [provider, setProvider] = useState(() => startupTarget.model?.provider ?? env.config.defaultProvider)
  const [model, setModel] = useState(() => startupTarget.model?.model ?? env.config.defaultModel)
  const [overlay, setOverlay] = useState<null | "model" | "skills" | "resume" | "permissions" | "agent" | "mcp" | "child" | "childpick">(null)
  const overlayRef = useRef<null | "model" | "skills" | "resume" | "permissions" | "agent" | "mcp" | "child" | "childpick">(null)
  const [mcpStates, setMcpStates] = useState<McpServerState[]>([])
  // Subagent children of the current turn (or of the resumed session), in
  // launch order: index 0 = ctrl+1. childTrans holds each child's transcript
  // keyed by session id — it survives the turn (ctrl+N works after commit)
  // and is rehydrated from the store on /resume. kidsRef mirrors kids for the
  // useInput closure (ink batching stale-state hazard, same as sigintRef).
  const [kids, setKids] = useState<ChildInfo[]>([])
  const kidsRef = useRef<ChildInfo[]>([])
  const setKidsSync = (fn: (cur: ChildInfo[]) => ChildInfo[]) => { kidsRef.current = fn(kidsRef.current); setKids(kidsRef.current) }
  const [childTrans, setChildTrans] = useState<Map<string, TItem[]>>(new Map())
  const [childIdx, setChildIdx] = useState<number | null>(null)
  // Each live subagent tool item is linked to its child session id when
  // onSubagentStart arrives (the start precedes the child's first event, and
  // tool starts/child starts interleave in the same order — FIFO pair).
  const pendingSubRef = useRef<number[]>([])
  // Ticks once a second while a child runs so the live status line's elapsed
  // time moves; no timer while idle or when every child is done.
  const [now, setNow] = useState(() => Date.now())
  /** Set while /mcp authenticate waits for the browser, so ctrl+c can cancel that, not the session. */
  const authAbortRef = useRef<AbortController | null>(null)
  // Startup mode comes from the config (project file overrides the global
  // default); picking in /permissions re-persists it to the global config.
  const [yolo, setYolo] = useState(env.config.permissionMode === "yolo")
  const [retry, setRetry] = useState("")
  // Mid-turn spawn-side fatal (onFatal): turn-external message, rendered in the
  // chrome (an empty live transcript would otherwise hide the items copy).
  const [fatalMsg, setFatalMsg] = useState("")
  // Ref mirrors state: submit reads it — ink batching can make state stale.
  const yoloRef = useRef(yolo)
  const { stdout } = useStdout()

  const closeOverlay = () => { overlayRef.current = null; setOverlay(null); setChildIdx(null); sigintRef.current = 0 }

  const rows = (stdout as any)?.rows ?? 24

  // Elapsed-time ticker for live subagent lines: runs only while a child is
  // actually running (busy guards the turn, the some() guards done children).
  const kidsRunning = busy && kids.some(k => k.status === "running")
  useEffect(() => {
    if (!kidsRunning) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [kidsRunning])

  // Live items stream through this one ref so callbacks don't clobber each
  // other mid-turn (each setLive closure would see a different prev): the ref
  // is the single source; the epilogue appends it into the scrollback.
  const liveRef = useRef<TItem[]>([])
  const [scroll, setScroll] = useState(0)
  const pushLive = (fn: (cur: TItem[]) => TItem[]) => {
    liveRef.current = fn(liveRef.current)
    // View pin: while scrolled up, compensate growth so the pinned window
    // stays on the same lines (itemLines of the tail + separator gap).
    const tail = liveRef.current[liveRef.current.length - 1]
    if (tail) {
      const idx = liveRef.current.length - 1
      const now = tail.text.split("\n").length + (idx > 0 ? 1 : 0)
      const delta = now - (seenRef.current.idx === idx ? seenRef.current.lines : 0)
      seenRef.current = { idx, lines: now }
      if (delta > 0 && scrollRef.current > 0) { scrollRef.current += delta; setScroll(scrollRef.current) }
    }
    setLive(liveRef.current)
  }

  async function submit(text: string) {
    sigintRef.current = 0   // new turn: single ctrl+c aborts again, doesn't exit
    scrollRef.current = 0   // new turn: jump back to the tail
    seenRef.current = { idx: -1, lines: 0 }
    setScroll(0)
    if (text.startsWith("/")) {
      const say = (item: TItem) => setItems(is => [...is, item])
      if (text.trim() === "/exit") { say({ kind: "user", text }); return exit() }
      if (text.trim() === "/model") { say({ kind: "user", text }); overlayRef.current = "model"; setOverlay("model"); return }
      if (text.trim() === "/skills") { say({ kind: "user", text }); overlayRef.current = "skills"; setOverlay("skills"); return }
      if (text.trim() === "/mcp") {
        if (!busy) { say({ kind: "user", text }); setMcpStates(env.mcp.states()); overlayRef.current = "mcp"; setOverlay("mcp") }
        return
      }
      if (text.trim() === "/permissions") {
        if (!busy) { say({ kind: "user", text }); overlayRef.current = "permissions"; setOverlay("permissions") }
        return
      }
      if (text.trim() === "/agent") {
        if (!busy) { say({ kind: "user", text }); overlayRef.current = "agent"; setOverlay("agent") }
        return
      }
      if (text.trim() === "/resume") {
        if (!busy) { say({ kind: "user", text }); overlayRef.current = "resume"; setOverlay("resume") }
        return
      }
      say({ kind: "error", text: `${text} — use --plain mode for slash commands in v1` })
      return
    }
    const cfg = env.config.providers[provider]
    if (!cfg) {
      setItems(is => [...is, { kind: "user", text }, { kind: "error", text: "no provider configured (lugent.json)" }])
      return
    }
    setItems(is => [...is, { kind: "user", text }])
    const ac = new AbortController()
    abortRef.current = ac
    setAbort(ac)
    setBusy(true)
    // New turn: the children list restarts (ctrl+1..9 number the current
    // turn's children, in launch order).
    kidsRef.current = []
    setKids([])
    pendingSubRef.current = []
    setChildTrans(new Map())
    setNow(Date.now())
    let reasoning = ""
    let answer = ""
    const chatProvider = env.makeProvider?.(cfg, model) ?? new Provider(cfg, model)
    // runTurn re-calls provider.chat once per tool round; each round streams only
    // its own text, so the accumulators must reset or the transcript repeats
    // every earlier round prefixed into the next one.
    const chat = (args: any) => { reasoning = ""; answer = ""; return chatProvider.chat(args) }
    const r = await runTurn({
      store: env.store,
      provider: { chat },
      tools: env.tools,
      promptInput: buildPromptInput(env, model, agent),
      signal: ac.signal,
      yolo: yoloRef.current,
      agent,
      agents: env.agents,
      config: env.config,
      providerFor: (p: string, m: string) => env.makeProvider?.(env.config.providers[p], m) ?? new Provider(env.config.providers[p], m),
      onReasoning: t => { reasoning += t; pushLive(cur => patchTail(cur, { kind: "reasoning", text: reasoning })) },
      onToken: t => { answer += t; setRetry(""); pushLive(cur => patchTail(cur, { kind: "assistant", text: answer })) },
      onRetry: i => setRetry(`attempt ${i.attempt} failed — ${i.error} · retrying in ${Math.round(i.delayMs / 1000)}s`),
      onToolStart: (name, resource) => {
        pushLive(cur => [...cur, { kind: "tool", tool: name, text: resource }])
        if (name === "subagent") pendingSubRef.current.push(liveRef.current.length - 1)
      },
      onSubagentStart: (sid, aid) => {
        // Link the just-pushed live `subagent` tool item to its child so the
        // line can render live status (see decorateSubagents).
        const idx = pendingSubRef.current.shift()
        if (idx !== undefined) pushLive(cur => cur.map((it, i) => i === idx && it.kind === "tool" && it.tool === "subagent" ? { ...it, sub: sid } : it))
        setKidsSync(ks => [...ks, { sessionId: sid, agent: aid, status: "running", startedAt: Date.now(), activity: "starting" }])
      },
      onSubagentEvent: (sid, item) => {
        setKidsSync(ks => ks.map(k => k.sessionId === sid
          ? { ...k, activity: item.kind === "tool" ? `${item.tool} ${truncate(item.text, 32)}` : item.kind === "assistant" ? "writing" : "thinking" }
          : k))
        setChildTrans(m => {
          const next = new Map(m)
          const cur = next.get(sid) ?? []
          const last = cur[cur.length - 1]
          // Core accumulates child text per round, so same-kind deltas replace
          // the tail (the parent stream's patchTail behavior, per child).
          const merged = item.kind !== "tool" && last && last.kind === item.kind
            ? [...cur.slice(0, -1), item]
            : [...cur, item]
          next.set(sid, merged)
          return next
        })
      },
      onSubagentEnd: sid => {
        setKidsSync(ks => ks.map(k => k.sessionId === sid ? { ...k, status: "done", activity: undefined } : k))
      },
      // Spawn-side fatals must not kill the session: render and continue (issue #27).
      onFatal: m => { setItems(is => [...is, { kind: "error", text: m }]); setFatalMsg(m) },
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
    // The turn is final: move it into the scrollback (<Static> prints only the
    // new tail) and empty the frame. The ref is snapshotted BEFORE the updates:
    // state updaters run lazily at render time, so reading liveRef.current
    // inside the updater would see the emptied ref below and drop the turn.
    const finished = liveRef.current
    liveRef.current = []
    setItems(is => [...is, ...finished])
    setLive([])
    if (r.error) setItems(is => [...is, { kind: "error", text: r.error! }])
  }

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
    // ctrl+1..9: inspect child N of the turn (or of the resumed session).
    // Works while a child overlay is open too (switch directly). ctrl+9 past
    // 8 children opens the windowed picker instead — direct map for 1..8.
    // Only when no other overlay owns the keys and no dialog is pending.
    if (key.ctrl && /^[1-9]$/.test(input) && !ask && (!overlayRef.current || overlayRef.current === "child" || overlayRef.current === "childpick")) {
      const n = Number(input)
      if (n === 9 && kidsRef.current.length > 8) { overlayRef.current = "childpick"; setOverlay("childpick"); return }
      const kid = kidsRef.current[n - 1]
      if (kid) { setChildIdx(n - 1); overlayRef.current = "child"; setOverlay("child") }
      return
    }
    if (overlayRef.current || ask) return   // overlays/dialogs own the keys
    // page size = the live window (same value the region gets below)
    const budget = transcriptWindow(rows)
    if (key.pageUp) { scrollRef.current += budget; setScroll(scrollRef.current); return }
    if (key.pageDown) { scrollRef.current = Math.max(0, scrollRef.current - budget); setScroll(scrollRef.current) }
    // Keyboard-only scroll: shift+up/down = page up/down. Plain arrows and
    // Home/End belong to the composer (its caret moves) — ink dispatches every
    // key to every useInput handler, so frame scroll must not also consume them.
    else if (key.shift && key.upArrow) { scrollRef.current += budget; setScroll(scrollRef.current); return }
    else if (key.shift && key.downArrow) { scrollRef.current = Math.max(0, scrollRef.current - budget); setScroll(scrollRef.current); return }
  })

  // Splash pad: blank rows above the logo only while nothing has been said yet.
  const said = items.length > 1 || live.length > 0   // items[0] is the logo
  const pad = !said ? logoTopPad(rows) : 0
  const window = said ? transcriptWindow(rows) : splashWindow(rows)
  // Live subagent tool lines get their real-time status text at render time —
  // the stored items stay plain, so the scrollback commit prints the normal
  // completed line.
  const visible = decorateSubagents(clampItems(live, window, scroll), kids, now)
  // Frame height: capped at the viewport while a turn runs, an overlay/dialog
  // is open or the splash is up, but only as tall as the chrome when idle with
  // an empty live transcript — the conversation lives in the terminal's own
  // scrollback above, so a viewport-tall idle frame would put ~rows of blank
  // rows between the last message and the composer (the logo used to fill
  // them). Bottom-anchored frames make the growing/shrinking invisible in ink.
  const busyView = busy || !!overlay || !!ask || live.length > 0 || !said
  const frameH = busyView ? frameRows(rows) : Math.min(CHROME_HEIGHT, frameRows(rows))
  const agentsMd = safeAgentsMd(env.projectRoot)
  return (
    <>
      {/* Finalized history: <Static> prints each item once, above the frame,
          into the terminal's own scrollback. The wheel and click-drag selection
          scroll it natively — no mouse tracking, no virtualization. It must sit
          OUTSIDE the fixed-height frame: ink measures it as zero height in the
          layout, but nesting it inside height={frameRows} made the frame's own
          rows collapse whenever new static lines were printed.
          Mounted only once the conversation starts (`said`): items[0] is the
          logo, which must print to the scrollback ABOVE the first turn — on the
          empty splash the logo renders in the frame instead, so it is never
          printed twice. */}
      {said && (
        <Static items={items}>
          {(it, i) => <TranscriptItem key={i} it={it} marginTop={i > 0} />}
        </Static>
      )}
      {/* Root pinned to the viewport (minus one row, see frameRows) while busy;
          when idle with an empty live transcript it shrinks to the chrome alone
          (frameH above) so the composer sits right under the scrollback'd
          conversation instead of rows of blank. */}
      <Box flexDirection="column" flexShrink={0} height={frameH}>
      {/* Splash only: while nothing has been said, the logo opens centered in
          the frame. Once the conversation starts it lives exclusively in the
          scrollback (first <Static> item) — rendering it here put it between
          the history and every new turn, forever. */}
      {!said && <LogoMark topPad={pad} />}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} justifyContent="flex-end" overflowY="hidden">
        {/* Child viewer (ctrl+N) replaces the live transcript while open: same
            windowing budget, read-only, the composer below stays in place. */}
        {overlay === "child" && childIdx !== null && kids[childIdx]
          ? <ChildViewer
              index={childIdx}
              total={kids.length}
              info={kids[childIdx]}
              items={childTrans.get(kids[childIdx].sessionId) ?? []}
              onClose={closeOverlay} />
          : <Transcript items={visible} />}
      </Box>
      {/* Chrome: everything below the transcript in one flexShrink={0} block, so
          the transcript is what absorbs the slack (last child would otherwise
          be the one squeezed when the content is taller than the viewport). */}
      <Box flexDirection="column" flexShrink={0}>
      {retry && <Text color="yellow">{retry}</Text>}
      {/* Idle-time fatal refusals (agent/resume pickers) live in items; fatal
          messages arriving mid-turn (spawn-side, via onFatal) are turn-external
          — surface them here so they render even when live is empty. */}
      {fatalMsg && <Text color="red">error: {fatalMsg}</Text>}
      <ContextLine agent={agent} agentsMd={agentsMd} yolo={yolo} off={env.offProviders.includes(provider)} model={`${provider} · ${model}`} busy={busy && !ask} />
      {overlay === "agent"        ? <AgentPicker
            agents={primaryAgents(env.agents)}
            current={agent?.id}
            onClose={closeOverlay}
            onPick={a => {
              closeOverlay()
              const r = agentActivationModel(a, env.config.providers)
              if ("fatal" in r) { setItems(is => [...is, { kind: "error", text: r.fatal }]); return }
              setAgentState(a)
              env.store.setAgent(session.id, a.id)
              const target = r.model
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
              // The session remembers the picked model: /resume restores it later.
              env.store.setModel(session.id, prov, m)
              setItems(is => [...is, { kind: "system", text: `${prov} · ${m}` }])
            }}
          />
        : overlay === "skills"   ? <SkillList skills={env.skills} onClose={closeOverlay} />
        : overlay === "mcp"      ? <McpList
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
        : overlay === "resume"   ? <SessionPicker
            sessions={env.store.listSessions(env.projectRoot)}
            onClose={closeOverlay}
            onPick={id => {
              closeOverlay()
              const row = env.store.loadSession(id)
              if (!row) return
              setSession(row)
              const next = row.agent ? env.agents.find(a => a.id === row.agent) : undefined
              const r = agentActivationModel(next, env.config.providers)
              if ("fatal" in r) { setItems(is => [...is, { kind: "error", text: r.fatal }]); return }
              setAgentState(next)
              const target = r.model
              if (target) {
                setProvider(target.provider)
                setModel(target.model)
              } else if (row.provider) setProvider(row.provider)   // resume the session's own provider, not the current one
              if (target?.model ?? row.model) setModel(target?.model ?? row.model)
              // Replayed history is finalized content: it belongs in the scrollback.
              // APPEND, never replace: <Static> prints only new items, and the
              // scrollback of the previous session cannot be taken back — a
              // replace would leave the old lines in scrollback AND print the
              // replayed ones again on top.
              setItems(is => [...is, ...itemsFromHistory(env.store.getMessages(id)).map(it =>
                it.kind === "assistant" ? { ...it, kind: "system" } : it)])
              // Rehydrate this session's children from the store: ctrl+N works
              // after the turn commits and after /resume (reasoning was never
              // persisted — replay shows what the store has).
              const kidRows = env.store.children(id)
              kidsRef.current = kidRows.map(k => ({ sessionId: k.id, agent: k.agent ?? "subagent", status: "done", startedAt: 0 }))
              setKids(kidsRef.current)
              setChildTrans(new Map(kidRows.map(k => [k.id, itemsFromHistory(env.store.getMessages(k.id))])))
            }} />
          : overlay === "permissions"
            ? <PermissionMode
                current={yolo ? "yolo" : "normal"}
                onPick={m => {
                  closeOverlay()
                  yoloRef.current = m === "yolo"
                  setYolo(m === "yolo")
                  const saved = savePermissionMode(m, props.globalConfigPath ?? globalConfigPath())
                  const note = m === "yolo" ? "permission mode: yolo (auto-approve)" : "permission mode: normal"
                  setItems(is => [...is, { kind: "system", text: saved ? note : `${note} — save failed, session only` }])
                }}
                onClose={closeOverlay} />
          : overlay === "childpick"
            ? <ChildPicker
                kids={kids}
                onPick={i => { setChildIdx(i); overlayRef.current = "child"; setOverlay("child") }}
                onClose={closeOverlay} />
          : ask
            ? <Permissions tool={ask.tool} resource={ask.resource} onAnswer={a => { askRef.current = null; ask.resolve(a); setAsk(null) }} />
            : <Input
                disabled={busy || overlay === "child"}
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
      </Box>
    </>
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
  // Enable the kitty keyboard protocol (flag 1: disambiguate escape codes) so
  // ctrl+1..9 reaches the app as a distinct key — the legacy encoding sends a
  // plain digit with no modifier, and the composer owns those. Terminals
  // without the protocol ignore this CSI and keep legacy behavior (the viewer
  // keys stay dead there); the flags are popped on exit so the shell keeps
  // its own key bindings.
  stdout.write("\x1b[>1u")
  const inst = render(<App env={env} />, { exitOnCtrlC: false, stdin, stdout })
  return inst.waitUntilExit().finally(() => {
    stdout.write("\x1b[<u")
    inst.unmount()
  })
}
