import { Box, Text } from "ink"
import { parseMarkdown, type Seg } from "./markdown"
import { glyph } from "../ui"

export type TItem = { kind: "user" | "reasoning" | "tool" | "assistant" | "error"; text: string; tool?: string }

function Markdown({ text }: { text: string }) {
  return (
    <Box flexDirection="column">
      {parseMarkdown(text).map((line: Seg[], i: number) => (
        <Text key={i}>
          {line.map((s: Seg, j: number) => (
            <Text
              key={j}
              bold={s.bold}
              color={s.code ? "magenta" : s.header === 1 ? "cyan" : s.header ? "green" : undefined}
            >
              {s.header ? ` ${s.text}` : s.code ? ` ${s.text} ` : s.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

export function Transcript({ items }: { items: TItem[] }) {
  return (
    <Box flexDirection="column">
      {items.map((it, i) => (
        <Box key={i} flexDirection="column">
          {it.kind === "user" && <Text color="blue">> {it.text}</Text>}
          {it.kind === "reasoning" && <Text italic dimColor>{it.text}</Text>}
          {it.kind === "tool" && <Text color="yellow">{glyph(it.tool ?? "")} {it.tool} {it.text}</Text>}
          {it.kind === "assistant" && <Markdown text={it.text} />}
          {it.kind === "error" && <Text color="red">error: {it.text}</Text>}
        </Box>
      ))}
    </Box>
  )
}
