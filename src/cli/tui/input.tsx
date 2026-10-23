import { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"

const MAX_SUGGESTIONS = 5

export function Input(p: {
  disabled: boolean
  onSubmit(text: string): void
  completions?: { cmd: string; desc: string }[]
}) {
  const [value, setValue] = useState("")
  // Refs mirror state: ink may batch several keys into one render, so the
  // useInput closure can see a stale value/history mid-batch.
  const vRef = useRef("")
  const historyRef = useRef<string[]>([])
  const hIdxRef = useRef(-1)
  const [sel, setSel] = useState(0)
  const selRef = useRef(0)

  const setVal = (v: string) => { vRef.current = v; setValue(v) }
  // Reset only on change: an unconditional reset adds a setState per keystroke
  // and the extra renders shift ink's commit timing (racy key dispatch).
  const resetSel = () => { if (selRef.current !== 0) { selRef.current = 0; setSel(0) } }

  // Slash suggestions: only while the text is a bare "/prefix" (no space yet).
  const matchesFor = (v: string) =>
    !p.completions || !v.startsWith("/") || v.includes(" ")
      ? []
      : p.completions.filter(c => c.cmd.startsWith(v.slice(1))).slice(0, MAX_SUGGESTIONS)

  useInput((input, key) => {
    if (p.disabled) return
    if (key.ctrl || key.meta) return                 // ctrl/meta combos never type characters
    const open = matchesFor(vRef.current)
    if (key.return) {
      const t = vRef.current.trim()
      if (!t) return
      p.onSubmit(t)
      historyRef.current = [...historyRef.current, t].slice(-50)
      hIdxRef.current = -1
      resetSel()
      setVal("")
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
    if (key.backspace || key.delete) { resetSel(); setVal(vRef.current.slice(0, -1)); return }
    if (input && !key.escape) { resetSel(); setVal(vRef.current + input) }
  })

  const matches = matchesFor(value)

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderDimColor paddingX={1}>
        <Text color="cyan">&gt; </Text>
        <Text>{value}</Text>
        {!p.disabled && <Text dimColor>▏</Text>}
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
