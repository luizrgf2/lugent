import { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"
import { discoverModels } from "../../core/provider"

type Cfg = { baseUrl: string; apiKey?: string; models?: string[] }
type Phase = "name" | "url" | "key" | "test" | "import" | "confirm"

const FIELDS: { phase: Phase; label: string }[] = [
  { phase: "name", label: "name" },
  { phase: "url", label: "base url" },
  { phase: "key", label: "api key" },
]

const MASK = "•"

/**
 * `/add-provider` — register an OpenAI-compatible provider: name, base URL, key,
 * a Test that probes `<baseUrl>/models`, then an all-or-nothing import of every
 * model it advertises.
 *
 * Contract with the caller: the component never writes the config and never
 * closes itself after a save. It calls `onSaved(name, cfg)` and leaves the
 * persist + close decision to the App, exactly like `ModelPicker.onPick`.
 *
 * The key is display-only: it is held in state to be sent, but every render
 * shows a fixed number of dots, so a replayed frame cannot leak it.
 */
export function AddProvider(p: {
  existing: string[]
  shadowed?: boolean
  discover?: typeof discoverModels
  onSaved(name: string, cfg: Cfg): void
  onClose(): void
}) {
  const [phase, setPhase] = useState<Phase>("name")
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [key, setKey] = useState("")
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  // Refs mirror state: ink batches keys into one render, so the useInput closure
  // can otherwise read a stale phase/value mid-batch (input.tsx:34-36).
  const phaseRef = useRef<Phase>("name")
  const nameRef = useRef("")
  const urlRef = useRef("")
  const keyRef = useRef("")
  const modelsRef = useRef<string[]>([])
  const loadingRef = useRef(false)

  const go = (next: Phase) => { phaseRef.current = next; setPhase(next) }
  const clearMsg = () => { setError(null); setWarning(null) }
  const value = () => (phaseRef.current === "name" ? nameRef.current : phaseRef.current === "url" ? urlRef.current : keyRef.current)
  const write = (v: string) => {
    if (phaseRef.current === "name") { nameRef.current = v; setName(v) }
    else if (phaseRef.current === "url") { urlRef.current = v; setUrl(v) }
    else if (phaseRef.current === "key") { keyRef.current = v; setKey(v) }
  }

  const discover = p.discover ?? discoverModels

  function submitField() {
    const v = value()
    if (phaseRef.current === "name") {
      const n = v.trim()
      if (!n) { setError("name is required"); return }
      if (/\s/.test(v)) { setError("name cannot contain spaces"); return }
      if (v.includes("/")) { setError("name cannot contain /"); return }
      nameRef.current = n; setName(n)
      clearMsg(); go("url"); return
    }
    if (phaseRef.current === "url") {
      if (!/^https?:\/\/.+/.test(v.trim())) { setError("base url must start with http:// or https://"); return }
      const u = v.trim()
      urlRef.current = u; setUrl(u)
      clearMsg()
      if (!/\/v\d+\/?$/.test(u)) setWarning("no /v1 in the base url — most OpenAI-compatible endpoints need it")
      go("key"); return
    }
    if (phaseRef.current === "key") {
      // An empty key is legal: it keeps whatever the global config already holds.
      clearMsg(); go("test")
    }
  }

  async function runTest() {
    if (loadingRef.current) return
    loadingRef.current = true; setLoading(true); clearMsg()
    const r = await discover({ baseUrl: urlRef.current, apiKey: keyRef.current })
    loadingRef.current = false; setLoading(false)
    if (!r.ok) { setError(r.error ?? "test failed"); return }
    modelsRef.current = r.models; setModels(r.models)
    go("import")
  }

  function save() {
    const cfg: Cfg = { baseUrl: urlRef.current }
    if (keyRef.current) cfg.apiKey = keyRef.current
    if (modelsRef.current.length) cfg.models = modelsRef.current
    p.onSaved(nameRef.current, cfg)
  }

  function submitImport() {
    if (p.existing.includes(nameRef.current)) { go("confirm"); return }
    save()
  }

  useInput((input, k) => {
    if (k.escape) { p.onClose(); return }
    // Test/import/confirm are action phases: no text editing, only enter.
    if (phaseRef.current !== "name" && phaseRef.current !== "url" && phaseRef.current !== "key") {
      if (!k.return) return
      if (phaseRef.current === "test") { void runTest(); return }
      if (phaseRef.current === "import") { submitImport(); return }
      if (phaseRef.current === "confirm") save()
      return
    }
    if (k.return) { submitField(); return }
    if (k.backspace || k.delete) { write(value().slice(0, -1)); return }
    if (k.tab) { submitField(); return }
    if (input && !k.ctrl && !k.meta) write(value() + input)
  })

  const dots = MASK.repeat(key.length)
  const shown = (v: string) => (v ? v : "")

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text dimColor>/add-provider · register an OpenAI-compatible provider (saved to the global config)</Text>

      {FIELDS.map(f => (
        <Text key={f.phase} color={phase === f.phase ? "cyan" : undefined}>
          {phase === f.phase ? "❯" : " "} {f.label}:{" "}
          {f.phase === "key" ? dots : shown(f.phase === "name" ? name : url)}
          {phase === f.phase ? "▏" : ""}
        </Text>
      ))}

      {warning && <Text color="yellow">! {warning}</Text>}
      {error && <Text color="red">{error}</Text>}

      {phase === "test" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>test: {loading ? <Text dimColor>calling {url}/models…</Text> : "enter · call /models"}</Text>
          {error && <Text dimColor>nothing was written; fix the fields above and retest</Text>}
        </Box>
      )}

      {phase === "import" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>{models.length} model{models.length === 1 ? "" : "s"} found — import all of them?</Text>
          {models.map((m, i) => <Text key={m} dimColor>  {i + 1}. {m}</Text>)}
        </Box>
      )}

      {phase === "confirm" && (
        <Text color="yellow">
          overwrite {name}? its model list will be replaced; an empty key field keeps the current key
        </Text>
      )}

      <Text dimColor>
        {phase === "test" ? "enter test · esc cancel"
          : phase === "import" ? "enter import & save · esc cancel"
            : phase === "confirm" ? "enter overwrite · esc cancel"
              : "tab/enter next · esc cancel"}
      </Text>
      {p.shadowed && phase === "import" && (
        <Text color="yellow">note: this directory's lugent.json declares providers and will shadow the new one</Text>
      )}
    </Box>
  )
}
