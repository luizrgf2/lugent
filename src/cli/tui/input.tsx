import { useRef, useState } from "react"
import { Box, Text, useInput, usePaste } from "ink"

const MAX_SUGGESTIONS = 5

export const PASTE_TOKEN_MARK = "\u0000"
// Zero-width sentinel bounding each token: never typed (ink never delivers a
// literal NUL as input) and invisible to lastFrame() assertions. Navigation
// uses it to snap the caret around whole tokens instead of into them.
export const PASTE_TOKEN_SENTINEL = "\u0002"
// Full token shape in `value`: sentinel + visible label + sentinel. The
// sentinels are part of the expansion match, so expansion removes the whole
// atom and no control bytes can reach the model.
export const PASTE_TOKEN_RE = /\u0002\u0000\[paste #(\d+): (\d+) (lines|chars)\]\u0000\u0002/g

// A paste becomes a token when it would flood the composer: any embedded
// newline (ink would run key.return once per line, submitting mid-paste) or a
// long single line. Below both thresholds it types in place.
export function isLargePaste(text: string): boolean {
  return text.includes("\n") || text.length > 200
}

function tokenLabel(text: string, n: number): string {
  const lines = text.split("\n").length
  return lines > 1 ? `[paste #${n}: ${lines} lines]` : `[paste #${n}: ${text.length} chars]`
}

/** Expand paste tokens back to their full text for the model. */
export function expandTokens(text: string, pastes: Map<number, string>): string {
  return text.replace(PASTE_TOKEN_RE, (_m, n) => pastes.get(Number(n)) ?? _m)
}

export function Input(p: {
  disabled: boolean
  onSubmit(text: string): void
  completions?: { cmd: string; desc: string }[]
}) {
  const [value, setValue] = useState("")
  // Insertion caret: a flat index into `value`, always clamped to 0..value.length.
  const [cur, setCur] = useState(0)
  // Refs mirror state: ink may batch several keys into one render, so the
  // useInput closure can see a stale value/history/caret mid-batch.
  const vRef = useRef("")
  const curRef = useRef(0)
  const historyRef = useRef<string[]>([])
  const hIdxRef = useRef(-1)
  const [sel, setSel] = useState(0)
  const selRef = useRef(0)
  // Paste registry: tokens in `value` point at entries here; only submit and
  // history recall go through expandTokens.
  const pastesRef = useRef(new Map<number, string>())
  const pasteNRef = useRef(0)

  const clamp = (v: string, i: number) => Math.max(0, Math.min(i, v.length))
  // Snap a caret position out of token interiors: if the flat index lands
  // inside a sentinel-bounded token, move it to the nearest boundary. Keeps
  // tokens atomic — no keystroke can edit or corrupt a token's label bytes.
  const snapOutOfTokens = (v: string, i: number): number => {
    PASTE_TOKEN_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PASTE_TOKEN_RE.exec(v)) !== null) {
      const start = m.index
      const end = start + m[0].length
      if (i > start && i < end) return i - start <= end - i ? start : end
    }
    return i
  }
  // Caret steps through a token: moving right skips to the token's end,
  // moving left to its start — the arrow keeps its direction across the atom
  // instead of being trapped at the near boundary.
  const stepOverTokens = (v: string, i: number, dir: 1 | -1): number => {
    PASTE_TOKEN_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PASTE_TOKEN_RE.exec(v)) !== null) {
      const start = m.index
      const end = start + m[0].length
      if (i > start && i < end) return dir === 1 ? end : start
    }
    return i
  }
  const moveCur = (i: number, dir?: 1 | -1) => {
    const c = clamp(vRef.current, i)
    const j = dir ? stepOverTokens(vRef.current, c, dir) : snapOutOfTokens(vRef.current, c)
    curRef.current = j; setCur(j)
  }
  // Replacements default the caret to the end (history recall, completion, paste
  // chunks); a plain `setVal("")` (submit-clear) clamps it to 0.
  const setVal = (v: string, caret = v.length) => {
    vRef.current = v; setValue(v)
    const c = snapOutOfTokens(v, clamp(v, caret))
    curRef.current = c; setCur(c)
  }
  // Reset only on change: an unconditional reset adds a setState per keystroke
  // and the extra renders shift ink's commit timing (racy key dispatch).
  const resetSel = () => { if (selRef.current !== 0) { selRef.current = 0; setSel(0) } }

  // Slash suggestions: only while the text is a bare "/prefix" (no space yet).
  const matchesFor = (v: string) =>
    !p.completions || !v.startsWith("/") || v.includes(" ")
      ? []
      : p.completions.filter(c => c.cmd.startsWith(v.slice(1))).slice(0, MAX_SUGGESTIONS)

  // Suggestions still win on Enter; tokens never match a "/prefix" query
  // (token text starts with "["), so a prefix ending in a token stays a query.
  const submit = () => {
    const open = matchesFor(vRef.current)
    const t = (open.length ? "/" + open[Math.min(selRef.current, open.length - 1)].cmd : vRef.current).trim()
    if (!t) return
    // Expansion happens exactly once, here — the model gets the real paste.
    p.onSubmit(expandTokens(t, pastesRef.current))
    // History keeps the token form: recalling a 100-line paste must not
    // flood the composer again.
    historyRef.current = [...historyRef.current, t].slice(-50)
    hIdxRef.current = -1
    resetSel()
    setVal("")
  }

  useInput((input, key) => {
    if (p.disabled) return
    if (key.ctrl || key.meta) return                 // ctrl/meta combos never type characters
    const open = matchesFor(vRef.current)
    if (key.return) {
      submit()
      return
    }
    if (key.tab) {
      if (open.length) setVal("/" + open[Math.min(selRef.current, open.length - 1)].cmd)
      return
    }
    if (key.upArrow) {
      if (open.length) { selRef.current = Math.max(0, selRef.current - 1); setSel(selRef.current); return }
      const history = historyRef.current
      if (history.length) {
        const i = hIdxRef.current === -1 ? history.length - 1 : Math.max(0, hIdxRef.current - 1)
        hIdxRef.current = i; setVal(history[i]); return
      }
      return
    }
    if (key.downArrow) {
      if (open.length) { selRef.current = Math.min(open.length - 1, selRef.current + 1); setSel(selRef.current); return }
      if (hIdxRef.current !== -1) {
        const i = hIdxRef.current + 1
        if (i >= historyRef.current.length) { hIdxRef.current = -1; setVal("") }
        else { hIdxRef.current = i; setVal(historyRef.current[i]) }
      }
      return
    }
    if (key.leftArrow) { moveCur(curRef.current - 1, -1); return }
    if (key.rightArrow) { moveCur(curRef.current + 1, 1); return }
    if (key.home) { moveCur(0); return }
    if (key.end) { moveCur(vRef.current.length); return }
    if (key.backspace || key.delete) {
      resetSel()
      const v = vRef.current
      const c = curRef.current
      // A token immediately before the caret is one editing unit — its
      // displayed characters are a label, not text, so deleting them one by
      // one would be wrong. Regular text still deletes one character.
      const trailing = new RegExp(`${PASTE_TOKEN_SENTINEL}${PASTE_TOKEN_MARK}\\[paste #\\d+: \\d+ (?:lines|chars)\\]${PASTE_TOKEN_MARK}${PASTE_TOKEN_SENTINEL}$`)
      const before = v.slice(0, c)
      if (trailing.test(before)) {
        const token = before.match(trailing)![0]
        setVal(before.slice(0, -token.length) + v.slice(c), c - token.length)
      } else if (c > 0) {
        setVal(v.slice(0, c - 1) + v.slice(c), c - 1)
      }
      return
    }
    if (input && !key.escape) {
      resetSel()
      const v = vRef.current
      const c = curRef.current
      setVal(v.slice(0, c) + input + v.slice(c), c + input.length)
    }
  })

  usePaste(text => {
    if (p.disabled) return
    const v = vRef.current
    const c = curRef.current
    // Small paste types at the caret like ordinary input; a large one
    // (newline or 200+ chars) would flood the box and run key.return per
    // line, so it collapses into one NUL-delimited token inserted at the
    // caret instead.
    if (!isLargePaste(text)) { resetSel(); setVal(v.slice(0, c) + text + v.slice(c), c + text.length); return }
    const n = ++pasteNRef.current
    pastesRef.current.set(n, text)
    resetSel()
    const token = `${PASTE_TOKEN_SENTINEL}${PASTE_TOKEN_MARK}${tokenLabel(text, n)}${PASTE_TOKEN_MARK}${PASTE_TOKEN_SENTINEL}`
    setVal(v.slice(0, c) + token + v.slice(c), c + token.length)
  })

  const matches = matchesFor(value)

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderDimColor paddingX={1}>
        <Text color="cyan">&gt; </Text>
        {/* One text node, split around the caret: ink measures sibling <Text>s
            by their widest line, so a multi-line half would collapse its own
            newline into phantom width — nested children squash into a single
            string (measured and wrapped like the old whole-value text), while
            the dim caret keeps its style via its own inner <Text>. Control
            bytes (NUL mark, STX sentinels) render as zero-width, so the value
            displays raw. */}
        <Text>
          {value.slice(0, cur)}
          {!p.disabled && <Text dimColor>▏</Text>}
          {value.slice(cur)}
        </Text>
      </Box>
      {matches.length > 0 && (
        <Box flexDirection="column" paddingLeft={1}>
          {matches.map((c, i) => (
            <Text key={c.cmd} color={i === sel ? "cyan" : undefined}>
              {i === sel ? "❯" : " "} /{c.cmd} — {c.desc}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
