import { Box, Text, useInput } from "ink"

export function Permissions(p: { tool: string; resource: string; onAnswer(a: "y" | "n" | "a"): void }) {
  useInput((input) => {
    if (input === "y") p.onAnswer("y")
    else if (input === "n") p.onAnswer("n")
    else if (input === "a") p.onAnswer("a")
  })
  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">allow {p.tool} on "{p.resource}"? [y/n/a]</Text>
    </Box>
  )
}
