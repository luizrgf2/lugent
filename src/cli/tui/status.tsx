import { Box, Text, useAnimation } from "ink"
import type { Agent } from "../../core/types"

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".split("")

export function Spinner(p: { busy: boolean; label?: string }) {
  const { frame } = useAnimation({ interval: 80, isActive: p.busy })
  if (!p.busy) return null
  return (
    <Box paddingX={2}>
      <Text color="yellow">{FRAMES[frame % FRAMES.length]} </Text>
      <Text dimColor>{p.label ?? "working…"}</Text>
    </Box>
  )
}

// Fixed line above the input: AGENTS.md presence + current agent.
// Agents without a color (legacy files) fall back to magenta (build's color).
export function ContextLine(p: { agent?: Agent; agentsMd: string | null }) {
  if (!p.agentsMd && !p.agent) return null
  return (
    <Box paddingX={1}>
      {p.agentsMd && <Text color="yellow">§ AGENTS.md loaded </Text>}
      {p.agent && <Text color={p.agent.color ?? "magenta"}>· agent {p.agent.id}</Text>}
    </Box>
  )
}

// Mini L-mark (▟▙) from the ANSI logo / docs/lugent.svg — gradient endpoints
// as text colors: green chevron, cyan wordmark tail.
export function Status(p: { provider: string; model: string; sessionId: string; off: string[]; busy: boolean; yolo: boolean; agent?: string }) {
  return (
    <Box borderStyle="round" borderDimColor paddingX={1} justifyContent="space-between">
      <Box>
        <Text bold color="cyan">lugent</Text>
        <Text dimColor> {p.provider} · {p.model} </Text>
        {p.agent && <Text color="magenta">{p.agent} </Text>}
        {p.off.includes(p.provider) && <Text color="red">OFF</Text>}
      </Box>
      <Text bold>
        <Text color="green">▟▙ </Text>
        <Text>LUG</Text>
        <Text color="cyan">ENT</Text>
      </Text>
      <Box>
        {p.yolo && <Text bold color="red">YOLO </Text>}
        {p.busy && <Text color="yellow">⠋ working </Text>}
        <Text dimColor>{p.sessionId.slice(0, 8)}</Text>
      </Box>
    </Box>
  )
}
