import { Box, Text, useAnimation } from "ink"
import type { Agent } from "../../core/types"
import { LOGO_ROWS, WORDMARK_ROWS, WORDMARK_SPLIT, logoHex } from "../logo"

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

// Fixed line above the input — the app's whole chrome bar. Left: AGENTS.md
// presence, agent, YOLO badge, OFF warn (│ separators). Right, always
// visible: spinner + "working…" while a turn runs, otherwise just the
// provider · model. Agents without a color (legacy) fall back to magenta.
export function ContextLine(p: { agent?: Agent; agentsMd: string | null; yolo?: boolean; off?: boolean; model?: string; busy?: boolean }) {
  const { frame } = useAnimation({ interval: 80, isActive: !!p.busy })
  if (!p.agentsMd && !p.agent && !p.yolo && !p.model) return null
  return (
    <Box paddingX={1} justifyContent="space-between" marginTop={1}>
      <Text>
        {p.agentsMd && <Text color="yellow">§ AGENTS.md loaded </Text>}
        {p.agent && <Text color={p.agent.color ?? "magenta"}>│ agent {p.agent.id} </Text>}
        {p.yolo && <Text bold color="red">│ YOLO</Text>}
        {p.off && <Text bold color="red">│ OFF</Text>}
      </Text>
      {p.model && (
        <Text dimColor>
          {p.busy && <Text color="yellow">{FRAMES[frame % FRAMES.length]} working </Text>}
          {p.model}
        </Text>
      )}
    </Box>
  )
}

// The big L-mark with the block-letter wordmark beneath — rendered alone
// above everything (no border). Rows and colors come from src/cli/logo.ts —
// one shared raster + the SVG's exact gradient (#00f5a0 → #00d9f5) for both
// TUI and plain REPL. `topPad` (blank rows above, from logoTopPad) is what
// opens the splash screen with the mark in the vertical middle; it is 0 as
// soon as the transcript has content, so the mark keeps its place at the
// top during a session.
export function LogoMark({ topPad = 0 }: { topPad?: number } = {}) {
  const cyan = logoHex(LOGO_ROWS.length - 1)
  return (
    <Box flexDirection="column" alignItems="center" marginBottom={1} marginTop={topPad}>
      {LOGO_ROWS.map((l, i) => (
        <Text key={i} color={logoHex(i)}>{l}</Text>
      ))}
      {WORDMARK_ROWS.map((l, i) => (
        <Text key={`w${i}`} bold>
          <Text>{l.slice(0, WORDMARK_SPLIT)}</Text>
          <Text color={cyan}>{l.slice(WORDMARK_SPLIT)}</Text>
        </Text>
      ))}
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
      <Box>
        {p.yolo && <Text bold color="red">YOLO </Text>}
        {p.busy && <Text color="yellow">⠋ working </Text>}
        <Text dimColor>{p.sessionId.slice(0, 8)}</Text>
      </Box>
    </Box>
  )
}

