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

/** The same row cap the five sibling pickers use (`model-picker`, `agent-picker`,
 * `session-picker`, `skill-list`, `child-viewer`). */
const MAX_VISIBLE = 8

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
  /**
   * The entry the save would keep, by name — the same source the save writes.
   * An empty key field means "keep the current key", so the Test has to send that
   * key: built from the typed fields alone, a re-run against an endpoint that
   * enforces auth answers `401` to the only refresh path this form has. The entry
   * comes back raw, so `discoverModels` resolves a `{env:VAR}` (and reports an
   * unset variable) exactly as it does for a typed key.
   */
  storedEntry?: (name: string) => { baseUrl: string; apiKey?: string; models?: string[] } | undefined
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
  const loadingRef = useRef(false)
  // Which model the cursor is on, and which rows are checked for import. Index,
  // not id: an endpoint can advertise the same id twice (the render key is
  // `${start + i}-${m}` for exactly that reason), and a Set<string> would toggle
  // both rows at once. Refs mirror state: ink batches keys into one render.
  const [sel, setSel] = useState(0)
  const selRef = useRef(0)
  const setSelBoth = (i: number) => { selRef.current = i; setSel(i) }
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const pickedRef = useRef<Set<number>>(new Set())
  // Every mutation passes a NEW Set: `setPicked(ref.current)` after `add()` is the
  // same reference, and React bails out — the box would never appear.
  const setPickedBoth = (next: Set<number>) => { pickedRef.current = next; setPicked(next) }
  const chosenModels = () => models.filter((_, i) => pickedRef.current.has(i))
  // The models the file already holds for this name — the same source the Test
  // reads its key from. Drives both the pre-check and the removal notice.
  const [previous, setPrevious] = useState<string[]>([])
  const previousRef = useRef<string[]>([])

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
    // A blank key field keeps the stored key on save, so the Test must send the
    // same key — otherwise a re-run (the only refresh path) 401s on any endpoint
    // that enforces auth, and a `{env:VAR}` user cannot fix it by retyping.
    // `storedEntry` reads the file being written, per name.
    const stored = keyRef.current ? undefined : p.storedEntry?.(nameRef.current)?.apiKey
    const r = await discover({ baseUrl: urlRef.current, apiKey: keyRef.current || stored || "" })
    loadingRef.current = false; setLoading(false)
    if (!r.ok) {
      // A reachable endpoint that advertises nothing is not a typo in the key —
      // retesting will not help. Offer the models-less save (decision 6).
      if (r.noModels) { go("nomodels"); return }
      setError(r.error ?? "test failed"); return
    }
    setModels(r.models)
    const prev = p.storedEntry?.(nameRef.current)?.models ?? []
    previousRef.current = prev; setPrevious(prev)
    const keep = new Set<number>()
    // First occurrence only: a duplicate id keeps one row checked, not both.
    prev.forEach(id => {
      const i = r.models.indexOf(id)
      if (i >= 0) keep.add(i)
    })
    setPickedBoth(keep)
    setSelBoth(0)
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

  /**
   * `models` is the list this write will hold: the checked subset for an import,
   * `undefined` for a models-less save (the `nomodels` branch). An existing name
   * is confirmed first, and the confirmation names the count so a subset write is
   * never confirmed blind.
   */
  function commit(models?: string[]) {
    pendingModelsRef.current = models
    if (p.existing.includes(nameRef.current)) { go("confirm"); return }
    save(models)
  }

  /**
   * Recovery from a failed Test. The frame tells the user to fix the fields and
   * retest; without this the only exit was ESC, which discards a long url and
   * key. Values are kept, so a one-character typo costs one backspace.
   */
  function backToFields() {
    clearMsg()
    go("key")
  }

  /**
   * Walk the fields backwards (⌫ on an empty field, or ←). A wrong host, port or
   * `/v1` is the error class Test exists to catch, so the url above the key has
   * to be reachable — otherwise the whole form is retyped for one bad character.
   */
  function backField() {
    if (phaseRef.current === "url" && !loadingRef.current) { clearMsg(); go("name"); return }
    if (phaseRef.current === "key" && !loadingRef.current) { clearMsg(); go("url") }
  }

  useInput((input, k) => {
    if (k.escape) { p.onClose(); return }
    // Action phases: enter acts; test/import always allow a way back. Backspace
    // (or ←) from a failed test returns to the key with its value intact, and
    // the fields walk further back from there (see backField). From the
    // models-less prompt it returns to the test. Once models are listed or an
    // overwrite is being confirmed the only exits are enter and esc — nothing
    // there is a typo to correct.
    if (phaseRef.current !== "name" && phaseRef.current !== "url" && phaseRef.current !== "key") {
      const back = k.backspace || k.delete || k.leftArrow
      if (phaseRef.current === "test") {
        if (back) { backToFields(); return }
        if (k.return) void runTest()
        return
      }
      if (phaseRef.current === "nomodels") {
        if (back) { clearMsg(); go("test"); return }
        if (k.return) commit(undefined)
        return
      }
      if (phaseRef.current === "import") {
        const last = models.length - 1
        const move = (to: number) => setSelBoth(Math.max(0, Math.min(to, last)))
        if (k.upArrow) { move(selRef.current - 1); return }
        if (k.downArrow) { move(selRef.current + 1); return }
        if (k.pageUp || (k.shift && k.upArrow)) { move(selRef.current - MAX_VISIBLE); return }
        if (k.pageDown || (k.shift && k.downArrow)) { move(selRef.current + MAX_VISIBLE); return }
        if (k.home) { move(0); return }
        if (k.end) { move(last); return }
        // No `space` member in ink's Key (use-input.d.ts), so the character is the signal.
        if (input === " ") {
          const i = selRef.current
          const next = new Set(pickedRef.current)
          if (next.has(i)) next.delete(i); else next.add(i)
          setPickedBoth(next)
          return
        }
        if (input === "a") {
          setPickedBoth(pickedRef.current.size === models.length
            ? new Set()
            : new Set(models.map((_, i) => i)))
          return
        }
        if (k.return && pickedRef.current.size > 0) { commit(chosenModels()); return }
        return
      }
      if (!k.return) return
      if (phaseRef.current === "confirm") save(pendingModelsRef.current)
      return
    }
    if (k.return) { submitField(); return }
    if (k.backspace || k.delete) {
      // ⌫ on an empty field walks back to the previous one, values intact.
      if (value() === "") { backField(); return }
      write(value().slice(0, -1)); return
    }
    if (k.leftArrow) { backField(); return }
    if (k.tab) { submitField(); return }
    if (input && !k.ctrl && !k.meta) write(value() + input)
  })

  const dots = MASK.repeat(key.length)
  const shown = (v: string) => (v ? v : "")
  // Cursor window, the same arithmetic as model-picker.tsx:74: the window only
  // moves once the cursor passes the last visible row.
  const fit = models.length <= MAX_VISIBLE
  const start = sel < MAX_VISIBLE ? 0 : sel - MAX_VISIBLE + 1
  const view = models.slice(start, start + MAX_VISIBLE)
  const goneNow = previous.filter(id => !models.includes(id))
  const goneUnchecked = previous.filter(id => {
    const i = models.indexOf(id)
    return i >= 0 && !picked.has(i)
  })

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
          <Text dimColor>
            {p.existing.includes(name)
              ? `keep ${name}'s current model list? /model reads it, or fetches live when there is none`
              : `save ${name} without a model list? /model will fetch them live`}
          </Text>
        </Box>
      )}

      {phase === "import" && (
        <Box flexDirection="column" marginTop={1}>
          {goneNow.length > 0 && (
            <Text color="yellow">
              {goneNow.length} previously imported model{goneNow.length === 1 ? " is" : "s are"} no longer advertised
            </Text>
          )}
          {goneUnchecked.length > 0 && (
            <Text color="yellow">
              {goneUnchecked.length} previously imported model{goneUnchecked.length === 1 ? " will be" : "s will be"} removed (unchecked)
            </Text>
          )}
          <Text>
            {picked.size} of {models.length} model{models.length === 1 ? "" : "s"} selected
            {fit ? "" : ` — ${start + 1}-${start + view.length} of ${models.length}`}
          </Text>
          {view.map((m, i) => {
            const idx = start + i
            const on = picked.has(idx)
            return (
              <Text key={`${idx}-${m}`}>
                <Text color={idx === sel ? "cyan" : undefined}>{idx === sel ? "❯ " : "  "}</Text>
                <Text>{on ? "[x]" : "[ ]"}</Text>
                <Text dimColor> {m}</Text>
              </Text>
            )
          })}
        </Box>
      )}

      {phase === "confirm" && (
        <Text color="yellow">
          overwrite {name}? {pendingModelsRef.current
            ? `its model list will be replaced by the ${pendingModelsRef.current.length} you selected`
            : "it keeps its current model list (the endpoint advertised none this time)"}; an empty key field keeps the current key
        </Text>
      )}

      <Text dimColor>
        {phase === "test" ? "enter test · ⌫ edit · esc cancel"
          : phase === "nomodels" ? "enter save without models · ⌫ back · esc cancel"
            : phase === "import"
              ? (picked.size === 0
                ? "↑/↓ move · space toggle · select at least one · esc cancel"
                : `↑/↓ move · space toggle · enter import ${picked.size} & save · esc cancel`)
              : phase === "confirm" ? "enter overwrite · esc cancel"
                : "tab/enter next · ⌫/← back · esc cancel"}
      </Text>
      {p.shadowed && phase === "import" && (
        <Text color="yellow">note: this directory's lugent.json declares providers and will shadow the new one</Text>
      )}
    </Box>
  )
}
