import { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"
import { discoverModels } from "../../core/provider"

type Cfg = { baseUrl: string; apiKey?: string; models?: string[] }
type Phase = "name" | "url" | "key" | "test" | "nomodels" | "import" | "confirm"

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
  // What the next save will write: `undefined` = no list (models-less save, or a
  // `200` that advertised none). Both success paths go through `commit()`, so an
  // existing name gets the same overwrite confirmation either way.
  const pendingModelsRef = useRef<string[] | undefined>(undefined)
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
    if (!r.ok) {
      // A reachable endpoint that advertises nothing is not a typo in the key —
      // retesting will not help. Offer the models-less save (decision 6).
      if (r.noModels) { go("nomodels"); return }
      setError(r.error ?? "test failed"); return
    }
    modelsRef.current = r.models; setModels(r.models)
    pendingModelsRef.current = r.models
    go("import")
  }

  function save(models?: string[]) {
    const cfg: Cfg = { baseUrl: urlRef.current }
    if (keyRef.current) cfg.apiKey = keyRef.current
    // Omitted entirely when there is no list: `models` is optional in
    // `saveProvider`, and a provider without it still works (the picker falls
    // back to a live `listModels()`).
    if (models !== undefined) cfg.models = models
    p.onSaved(nameRef.current, cfg)
  }

  /** Shared by `import` and `nomodels`: confirm when the name already exists. */
  function commit(models?: string[]) {
    if (p.existing.includes(nameRef.current)) { go("confirm"); return }
    save(models)
  }

  function submitImport() { commit(pendingModelsRef.current) }

  /**
   * Recovery from a failed Test. The frame tells the user to fix the fields and
   * retest; without this the only exit was ESC, which discards a long url and
   * key. Values are kept, so a one-character typo costs one backspace.
   */
  function backToFields() {
    clearMsg()
    go("key")
  }

  useInput((input, k) => {
    if (k.escape) { p.onClose(); return }
    // Action phases: enter acts; test/import always allow a way back. Backspace
    // (or ←) from a failed test returns to the key with its value intact; from
    // the models-less prompt it returns to the test, where a different url can
    // be probed. Once models are listed or an overwrite is being confirmed the
    // only exits are enter and esc — nothing there is a typo to correct.
    if (phaseRef.current !== "name" && phaseRef.current !== "url" && phaseRef.current !== "key") {
      const back = k.backspace || k.delete || k.leftArrow
      if (phaseRef.current === "test") {
        if (back) { backToFields(); return }
        if (k.return) void runTest()
        return
      }
      if (phaseRef.current === "nomodels") {
        if (back) { clearMsg(); pendingModelsRef.current = undefined; go("test"); return }
        if (k.return) commit(undefined)
        return
      }
      if (!k.return) return
      if (phaseRef.current === "import") { submitImport(); return }
      if (phaseRef.current === "confirm") save(pendingModelsRef.current)
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
          {error && <Text dimColor>nothing was written; backspace to edit, or retest</Text>}
        </Box>
      )}

      {phase === "nomodels" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">the endpoint works but lists no models</Text>
          <Text dimColor>save {name} without a model list? /model will fetch them live</Text>
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
          overwrite {name}? {pendingModelsRef.current
            ? "its model list will be replaced"
            : "it keeps no model list (the endpoint advertised none)"}; an empty key field keeps the current key
        </Text>
      )}

      <Text dimColor>
        {phase === "test" ? "enter test · ⌫ edit · esc cancel"
          : phase === "nomodels" ? "enter save without models · ⌫ back · esc cancel"
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
