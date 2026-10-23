import { useRef, useState } from "react"
import { Box, render, useApp, useInput, useStdout } from "ink"
import type { ReplEnv } from "../repl"
import type { Agent } from "../../core/types"
import { Provider } from "../../core/provider"
import { runTurn } from "../../core/loop"
import { toolsForAgent, agentModelTarget } from "../../core/agents"
import { buildPromptInput } from "../context"
import { Status, Spinner } from "./status"
import { Transcript, clampItems, itemLines, itemsFromHistory, type TItem } from "./transcript"
import { Input } from "./input"
import { Permissions } from "./permissions"
import { ModelPicker } from "./model-picker"
import { AgentPicker } from "./agent-picker"
import { SkillList } from "./skill-list"
import { PermissionMode } from "./permission-mode"
import { SessionPicker } from "./session-picker"

export type TuiEnv = ReplEnv & {
  offProviders: string[]
  makeProvider?: (cfg: any, model: string) => { chat(args: any): Promise<any> }
}

function patchTail(items: TItem[], item: TItem): TItem[] {
  return items.length && items[items.length - 1].kind === item.kind
    ? [...items.slice(0, -1), item]
    : [...items, item]
}

export function App(props: { env: TuiEnv }) {
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
  const itemLinesOf = (it: TItem): number =>
    it.kind === "assistant" ? Math.max(1, it.text.split("\n").length) : 1
  // The loop runs tool calls in parallel; several can require permission at
  // once. A bare setAsk keeps only the last dialog and loses the first
  // resolve → Promise.all never settles → turn hangs. Queue asks instead.
  const askChainRef = useRef<Promise<void>>(Promise.resolve())
  const askRef = useRef<{ tool: string; resource: string; resolve(a: "y" | "n" | "a"): void } | null>(null)
  const [abort, setAbort] = useState<AbortController | null>(null)
  const [agent, setAgentState] = useState<Agent | undefined>(() => env.agents.find(a => a.id === env.config.defaultAgent))
  const [session, setSession] = useState(() => env.store.createSession(env.config.defaultProvider, env.config.defaultModel, env.projectRoot, agent?.id ?? null))
  // A defaultAgent's model (when its provider is configured) wins over the config default at startup.
  const [provider, setProvider] = useState(() => agentModelTarget(agent, env.config.providers)?.provider ?? env.config.defaultProvider)
  const [model, setModel] = useState(() => agentModelTarget(agent, env.config.providers)?.model ?? env.config.defaultModel)
  const [overlay, setOverlay] = useState<null | "model" | "skills" | "resume" | "permissions" | "agent">(null)
  const overlayRef = useRef<null | "model" | "skills" | "resume" | "permissions" | "agent">(null)
  const [yolo, setYolo] = useState(false)
  // Ref mirrors state: submit reads it — ink batching can make state stale.
  const yoloRef = useRef(false)
  const { stdout } = useStdout()

  const closeOverlay = () => { overlayRef.current = null; setOverlay(null) }

  const budget = () => Math.max(3, ((stdout as any)?.rows ?? 24) - 7)

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
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
      onToken: t => { answer += t; grow(is => patchTail(is, { kind: "assistant", text: answer })) },
      onToolStart: (name, resource) => setItems(is => [...is, { kind: "tool", tool: name, text: resource }]),
      onAsk: (tool, resource) => new Promise(resolve => {
        askChainRef.current = askChainRef.current.then(() => new Promise<void>(release => {
          if (abortRef.current?.signal.aborted) { resolve("n"); release(); return }
          askRef.current = { tool, resource, resolve: a => { resolve(a); release() } }
          setAsk(askRef.current)
        }))
      }),
    }, session.id, text, env.projectRoot)
    setBusy(false)
    abortRef.current = null
    setAbort(null)
    setAsk(null)
    if (r.error) setItems(is => [...is, { kind: "error", text: r.error! }])
  }

  // ink resolves height="100%" to auto — constrain manually from real rows.
  const rows = (stdout as any)?.rows ?? 24
  const visible = clampItems(items, Math.max(3, rows - 7), scroll)

  return (
    <Box flexDirection="column">
      <Status provider={provider} model={model} sessionId={session.id} off={env.offProviders} busy={busy} yolo={yolo} agent={agent?.id} />
      <Box flexDirection="column">
        <Transcript items={visible} />
      </Box>
      {overlay === "agent"
        ? <AgentPicker
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
                  { cmd: "resume", desc: "resume a past session" },
                  { cmd: "permissions", desc: "permission mode (normal/yolo)" },
                  { cmd: "agent", desc: "switch agent profile" },
                ]} />}
      <Spinner busy={busy && !ask} />
    </Box>
  )
}

export function runTui(env: TuiEnv): Promise<void> {
  const inst = render(<App env={env} />, { exitOnCtrlC: false })
  return inst.waitUntilExit()
}
