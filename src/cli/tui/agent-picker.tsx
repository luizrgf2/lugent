import { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { Agent } from "../../core/types"

const MAX_VISIBLE = 8

export function AgentPicker(p: {
  agents: Agent[]
  current?: string
  onPick(a: Agent): void
  onClose(): void
}) {
  const [sel, setSel] = useState(() => Math.max(0, p.agents.findIndex(a => a.id === p.current)))
  // Ref mirrors state: ink batches keys into one render (same hazard as input.tsx).
  const selRef = useRef(sel)
  const setSelBoth = (i: number) => { selRef.current = i; setSel(i) }

  useInput((_input, key) => {
    if (key.upArrow) { setSelBoth(Math.max(0, selRef.current - 1)); return }
    if (key.downArrow) { setSelBoth(Math.min(p.agents.length - 1, selRef.current + 1)); return }
    if (key.return) { const a = p.agents[selRef.current]; if (a) p.onPick(a); return }
    if (key.escape) p.onClose()
  })

  const start = sel < MAX_VISIBLE ? 0 : sel - MAX_VISIBLE + 1
  const view = p.agents.slice(start, start + MAX_VISIBLE)

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text dimColor>/agent · choose agent</Text>
      {view.length === 0
        ? <Text dimColor>(no agents — drop one in .agents/agents/)</Text>
        : view.map((a, i) => {
            const idx = start + i
            return (
              <Text key={a.id} color={idx === sel ? "cyan" : undefined}>
                {idx === sel ? "❯" : " "} {a.id}{a.id === p.current ? " ●" : ""}{a.description ? ` — ${a.description}` : ""}
              </Text>
            )
          })}
      <Text dimColor>↑/↓ move · enter select · esc cancel</Text>
    </Box>
  )
}
