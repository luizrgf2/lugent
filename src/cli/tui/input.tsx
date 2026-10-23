import { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"

export function Input(p: { disabled: boolean; onSubmit(text: string): void }) {
  const [value, setValue] = useState("")
  // Refs mirror state: ink may batch several keys into one render, so the
  // useInput closure can see a stale value/history mid-batch.
  const vRef = useRef("")
  const historyRef = useRef<string[]>([])
  const hIdxRef = useRef(-1)

  const setVal = (v: string) => { vRef.current = v; setValue(v) }

  useInput((input, key) => {
    if (p.disabled) return
    if (key.ctrl || key.meta) return                 // ctrl/meta combos never type characters
    if (key.return) {
      const t = vRef.current.trim()
      if (!t) return
      p.onSubmit(t)
      historyRef.current = [...historyRef.current, t].slice(-50)
      hIdxRef.current = -1
      setVal("")
      return
    }
    const history = historyRef.current
    if (key.upArrow && history.length) {
      const i = hIdxRef.current === -1 ? history.length - 1 : Math.max(0, hIdxRef.current - 1)
      hIdxRef.current = i; setVal(history[i]); return
    }
    if (key.downArrow && hIdxRef.current !== -1) {
      const i = hIdxRef.current + 1
      if (i >= history.length) { hIdxRef.current = -1; setVal("") }
      else { hIdxRef.current = i; setVal(history[i]) }
      return
    }
    if (key.backspace || key.delete) { setVal(vRef.current.slice(0, -1)); return }
    if (input && !key.escape) setVal(vRef.current + input)
  })

  return (
    <Box borderStyle="round" borderDimColor paddingX={1}>
      <Text color="cyan">&gt; </Text>
      <Text>{value}</Text>
      {!p.disabled && <Text dimColor>▏</Text>}
    </Box>
  )
}
