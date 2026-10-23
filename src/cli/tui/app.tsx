import { useRef, useState } from "react"
import { Box, render, useApp, useInput, useStdout } from "ink"
import type { ReplEnv } from "../repl"
import { Provider } from "../../core/provider"
import { runTurn } from "../../core/loop"
import { buildPromptInput } from "../context"
import { Status } from "./status"
import { Transcript, clampItems, type TItem } from "./transcript"
import { Input } from "./input"
import { Permissions } from "./permissions"
import { ModelPicker } from "./model-picker"
import { SkillList } from "./skill-list"

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
  // The loop runs tool calls in parallel; several can require permission at
  // once. A bare setAsk keeps only the last dialog and loses the first
  // resolve → Promise.all never settles → turn hangs. Queue asks instead.
  const askChainRef = useRef<Promise<void>>(Promise.resolve())
  const askRef = useRef<{ tool: string; resource: string; resolve(a: "y" | "n" | "a"): void } | null>(null)
  const [abort, setAbort] = useState<AbortController | null>(null)
  const [session] = useState(() => env.store.createSession(env.config.defaultProvider, env.config.defaultModel))
  const [provider, setProvider] = useState(env.config.defaultProvider)
  const [model, setModel] = useState(env.config.defaultModel)
  const [overlay, setOverlay] = useState<null | "model" | "skills">(null)
  const overlayRef = useRef<null | "model" | "skills">(null)
  const { stdout } = useStdout()

  const closeOverlay = () => { overlayRef.current = null; setOverlay(null) }

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
    }
  })

  async function submit(text: string) {
    sigintRef.current = 0   // new turn: single ctrl+c aborts again, doesn't exit
    setItems(is => [...is, { kind: "user", text }])
    if (text.startsWith("/")) {
      if (text.trim() === "/exit") return exit()
      if (text.trim() === "/model") { overlayRef.current = "model"; setOverlay("model"); return }
      if (text.trim() === "/skills") { overlayRef.current = "skills"; setOverlay("skills"); return }
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
    const chatProvider = env.makeProvider?.(cfg, model) ?? new Provider(cfg, model)
    const r = await runTurn({
      store: env.store,
      provider: chatProvider,
      tools: env.tools,
      promptInput: buildPromptInput(env, model),
      signal: ac.signal,
      onReasoning: t => { reasoning += t; setItems(is => patchTail(is, { kind: "reasoning", text: reasoning })) },
      onToken: t => { answer += t; setItems(is => patchTail(is, { kind: "assistant", text: answer })) },
      onToolStart: (name, resource) => setItems(is => [...is, { kind: "tool", tool: name, text: resource }]),
      onAsk: (tool, resource) => new Promise(resolve => {
        askChainRef.current = askChainRef.current.then(() => new Promise<void>(release => {
          if (abortRef.current?.signal.aborted) { resolve("n"); release(); return }
          askRef.current = { tool, resource, resolve: a => { resolve(a); release() } }
          setAsk(askRef.current)
        }))
      }),
    }, session.id, text)
    setBusy(false)
    abortRef.current = null
    setAbort(null)
    setAsk(null)
    if (r.error) setItems(is => [...is, { kind: "error", text: r.error! }])
  }

  // ink resolves height="100%" to auto — constrain manually from real rows.
  const rows = (stdout as any)?.rows ?? 24
  const visible = clampItems(items, Math.max(3, rows - 7))

  return (
    <Box flexDirection="column">
      <Status provider={provider} model={model} sessionId={session.id} off={env.offProviders} busy={busy} />
      <Box flexDirection="column">
        <Transcript items={visible} />
      </Box>
      {overlay === "model"
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
          : ask
            ? <Permissions tool={ask.tool} resource={ask.resource} onAnswer={a => { askRef.current = null; ask.resolve(a); setAsk(null) }} />
            : <Input
                disabled={busy}
                onSubmit={submit}
                completions={[
                  { cmd: "exit", desc: "quit lugent" },
                  { cmd: "model", desc: "switch provider/model" },
                  { cmd: "skills", desc: "browse skills" },
                ]} />}
    </Box>
  )
}

export function runTui(env: TuiEnv): Promise<void> {
  const inst = render(<App env={env} />, { exitOnCtrlC: false })
  return inst.waitUntilExit()
}
