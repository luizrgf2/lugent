import { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { SessionSummary } from "../../core/store"

const MAX_VISIBLE = 8

/** /resume picker: sessions of the current directory, newest first. */
export function SessionPicker(p: {
  sessions: SessionSummary[]
  onPick(id: string): void
  onClose(): void
}) {
  // Refs mirror state: ink batches keys into one render; closures read fresh values.
  const selRef = useRef(0)
  const [sel, setSel] = useState(0)
  const [offset, setOffset] = useState(0)

  useInput((_input, key) => {
    if (!p.sessions.length) {
      if (key.return || key.escape) p.onClose()
      return
    }
    if (key.upArrow) {
      selRef.current = Math.max(0, selRef.current - 1)
      setSel(selRef.current)
      if (selRef.current < offset) setOffset(selRef.current)
      return
    }
    if (key.downArrow) {
      selRef.current = Math.min(p.sessions.length - 1, selRef.current + 1)
      setSel(selRef.current)
      if (selRef.current >= offset + MAX_VISIBLE) setOffset(selRef.current - MAX_VISIBLE + 1)
      return
    }
    if (key.return) { p.onPick(p.sessions[selRef.current].id); return }
    if (key.escape) { p.onClose(); return }
  })

  const view = p.sessions.slice(offset, offset + MAX_VISIBLE)

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text dimColor>/resume · {p.sessions.length} session(s) in this directory</Text>
      {p.sessions.length === 0
        ? <Text dimColor>(no sessions in this directory)</Text>
        : view.map((s, i) => {
            const idx = offset + i
            return (
              <Text key={s.id} color={idx === sel ? "cyan" : undefined}>
                {idx === sel ? "❯" : " "} {s.id.slice(0, 8)} · {s.model} · {s.preview}
              </Text>
            )
          })}
      <Text dimColor>↑/↓ move · enter resume · esc cancel</Text>
    </Box>
  )
}
