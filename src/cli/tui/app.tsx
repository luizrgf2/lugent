import { useState } from "react"
import { Box, Text, render, useApp, useInput } from "ink"
import type { ReplEnv } from "../repl"
import { Provider } from "../../core/provider"
import { runTurn } from "../../core/loop"
import { buildPromptInput } from "../context"
import { Status } from "./status"
import { Transcript, type TItem } from "./transcript"
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
  const [sigint, setSigint] = useState(0)
  const [abort, setAbort] = useState<AbortController | null>(null)
  const [session] = useState(() => env.store.createSession(env.config.defaultProvider, env.config.defaultModel))
  const [model] = useState(env.config.defaultModel)

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      const n = sigint + 1
      setSigint(n)
      if (n === 1) {
        abort?.abort()
        ask?.resolve("n")   // deny pending permission so the turn can unwind
        setAsk(null)
      } else {
        exit()
      }
    }
  })

  async function submit(text: string) {
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
      onAsk: (tool, resource) => new Promise(resolve => setAsk({ tool, resource, resolve })),
    }, session.id, text)
    setBusy(false)
    setAbort(null)
    setAsk(null)
    if (r.error) setItems(is => [...is, { kind: "error", text: r.error! }])
  }

  return (
    <Box flexDirection="column" height="100%">
      <Status provider={env.config.defaultProvider} model={model} sessionId={session.id} off={env.offProviders} busy={busy} />
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <Transcript items={items} />
      </Box>
      {ask
        ? <Permissions tool={ask.tool} resource={ask.resource} onAnswer={a => { ask.resolve(a); setAsk(null) }} />
        : <Input disabled={busy} onSubmit={submit} />}
    </Box>
  )
}

export function runTui(env: TuiEnv): Promise<void> {
  const inst = render(<App env={env} />, { exitOnCtrlC: false })
  return inst.waitUntilExit()
}
