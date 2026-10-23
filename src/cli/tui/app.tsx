import { Box, Text } from "ink"

export function App(props: { env: any }) {
  return (
    <Box flexDirection="column" height="100%">
      <Box>
        <Text bold color="cyan">lugent</Text>
        <Text dimColor> · {props.env.config.defaultProvider} · {props.env.config.defaultModel}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} />
    </Box>
  )
}
