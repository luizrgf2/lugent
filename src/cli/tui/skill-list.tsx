import { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"

const MAX_VISIBLE = 8

export function SkillList(p: { skills: { id: string; name: string; description: string }[]; onClose(): void }) {
  const [sel, setSel] = useState(0)
  // Ref mirrors state: ink batches keys into one render; closures read fresh values.
  const selRef = useRef(0)
  const [offset, setOffset] = useState(0)

  useInput((_input, key) => {
    if (key.upArrow) {
      selRef.current = Math.max(0, selRef.current - 1)
      setSel(selRef.current)
      if (selRef.current < offset) setOffset(selRef.current)
      return
    }
    if (key.downArrow) {
      selRef.current = Math.min(p.skills.length - 1, selRef.current + 1)
      setSel(selRef.current)
      if (selRef.current >= offset + MAX_VISIBLE) setOffset(selRef.current - MAX_VISIBLE + 1)
      return
    }
    if (key.return || key.escape) { p.onClose(); return }
  })

  const view = p.skills.slice(offset, offset + MAX_VISIBLE)

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text dimColor>/skills · {p.skills.length} loaded (user ~/.agents/skills + project .agents/skills)</Text>
      {view.length === 0
        ? <Text dimColor>(no skills found)</Text>
        : view.map((s, i) => {
            const idx = offset + i
            return (
              <Text key={s.id} color={idx === sel ? "cyan" : undefined}>
                {idx === sel ? "❯" : " "} {s.id} — {s.name}
              </Text>
            )
          })}
      {view[sel - offset] && <Text dimColor>  {view[sel - offset].description}</Text>}
      <Text dimColor>↑/↓ move · enter/esc close</Text>
    </Box>
  )
}
