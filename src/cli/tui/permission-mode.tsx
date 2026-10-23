import { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"

const MODES = [
  { id: "normal", desc: "ask before each write/shell/outside-project action" },
  { id: "yolo", desc: "auto-approve every tool call (no dialogs)" },
]

export function PermissionMode(p: { current: "normal" | "yolo"; onPick(m: "normal" | "yolo"): void; onClose(): void }) {
  const [sel, setSel] = useState(p.current === "yolo" ? 1 : 0)
  // Ref mirrors state: ink batches keys into one render; closures read fresh values.
  const selRef = useRef(sel)

  useInput((_input, key) => {
    if (key.upArrow) { selRef.current = Math.max(0, selRef.current - 1); setSel(selRef.current); return }
    if (key.downArrow) { selRef.current = Math.min(MODES.length - 1, selRef.current + 1); setSel(selRef.current); return }
    if (key.return) { p.onPick(MODES[selRef.current].id); return }
    if (key.escape) p.onClose()
  })

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text dimColor>/permissions · permission mode (session-scoped, not persisted)</Text>
      {MODES.map((m, i) => (
        <Text key={m.id} color={i === sel ? "cyan" : undefined}>
          {i === sel ? "❯" : " "} {m.id}{m.id === p.current ? " ●" : ""}
        </Text>
      ))}
      <Text dimColor>  {MODES[sel].desc}</Text>
      <Text dimColor>↑/↓ move · enter select · esc cancel</Text>
    </Box>
  )
}
