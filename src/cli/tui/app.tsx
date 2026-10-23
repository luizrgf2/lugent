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
  const [model] = useState(env.config.defaultModel)
  const { stdout } = useStdout()

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
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
      setItems(is => [...is, { kind: "error", text: `${text} — use --plain mode for slash commands in v1` }])
      return
    }
    const cfg = env.config.providers[env.config.defaultProvider]
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
    const provider = env.makeProvider?.(cfg, model) ?? new Provider(cfg, model)
    const r = await runTurn({
      store: env.store,
      provider,
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
      <Status provider={env.config.defaultProvider} model={model} sessionId={session.id} off={env.offProviders} busy={busy} />
      <Box flexDirection="column">
        <Transcript items={visible} />
      </Box>
      {ask
        ? <Permissions tool={ask.tool} resource={ask.resource} onAnswer={a => { askRef.current = null; ask.resolve(a); setAsk(null) }} />
        : <Input disabled={busy} onSubmit={submit} />}
    </Box>
  )
}

export function runTui(env: TuiEnv): Promise<void> {
  const inst = render(<App env={env} />, { exitOnCtrlC: false })
  return inst.waitUntilExit()
}
