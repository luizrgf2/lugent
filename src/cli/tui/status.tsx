import { Box, Text } from "ink"

export function Status(p: { provider: string; model: string; sessionId: string; off: string[]; busy: boolean }) {
  return (
    <Box borderStyle="round" borderDimColor paddingX={1}>
      <Text bold color="cyan">lugent</Text>
      <Text dimColor> {p.provider} · {p.model} · {p.sessionId.slice(0, 8)} </Text>
      {p.off.includes(p.provider) && <Text color="red">OFF</Text>}
      {p.busy && <Text color="yellow"> ⠋ working</Text>}
    </Box>
  )
}
