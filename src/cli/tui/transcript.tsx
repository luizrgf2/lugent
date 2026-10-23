import { memo } from "react"
import { Box, Text } from "ink"
import { parseMarkdown, type Seg } from "./markdown"
import { glyph } from "../ui"
import type { Message } from "../../core/types"

export type TItem = { kind: "user" | "reasoning" | "tool" | "assistant" | "error" | "system"; text: string; tool?: string }

/** Map stored history to transcript items on resume (reasoning is never persisted). */
export function itemsFromHistory(messages: Message[]): TItem[] {
  const callInfo = new Map<string, { name: string; args: unknown }>()
  for (const m of messages) for (const tc of m.toolCalls ?? []) callInfo.set(tc.id, tc)
  const out: TItem[] = []
  for (const m of messages) {
    if (m.role === "user" && m.content) out.push({ kind: "user", text: m.content })
    else if (m.role === "assistant" && m.content) out.push({ kind: "assistant", text: m.content })
    else if (m.role === "tool") {
      const tc = callInfo.get(m.toolCallId ?? "")
      out.push({ kind: "tool", tool: tc?.name ?? "?", text: describeArgs(tc?.args) })
    }
  }
  return out
}

function describeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return ""
  const a = args as Record<string, unknown>
  const res = a.path ?? a.pattern ?? a.command ?? a.id ?? a.resource ?? Object.values(a)[0]
  return typeof res === "string" ? res : JSON.stringify(args)
}

function itemLines(it: TItem): number {
  return it.kind === "assistant" ? Math.max(1, it.text.split("\n").length) : 1
}
export { itemLines }

/**
 * Keep only the newest content that fits `maxLines` lines (a multi-line item is
 * tailed, not dropped). Ink resolves height="100%" to auto, so the transcript
 * window must be constrained manually from the real terminal rows.
 * `skipBottom` scrolls up: it drops the newest `skipBottom` lines and shows the
 * window just above them (a straddling item is headed, i.e. sliced from the
 * top). Returns [] when scrolled past everything.
 */
export function clampItems(items: TItem[], maxLines: number, skipBottom = 0): TItem[] {
  const out: TItem[] = []
  let used = 0
  for (let i = items.length - 1; i >= 0; i--) {
    const lines = itemLines(items[i])
    if (skipBottom > 0) {
      const skip = Math.min(lines, skipBottom)
      skipBottom -= skip
      if (skip === lines) continue                  // fully hidden
      // straddles the hidden tail: show its head, capped to the window
      const head = items[i].text.split("\n").slice(0, lines - skip)
      const shown = head.length > maxLines ? head.slice(head.length - maxLines) : head
      out.unshift({ ...items[i], text: shown.join("\n") })
      used += shown.length
      continue
    }
    if (used + lines > maxLines) {
      const room = maxLines - used
      if (out.length === 0 && room > 0 && items[i].kind === "assistant") {
        out.unshift({ ...items[i], text: items[i].text.split("\n").slice(-room).join("\n") })
      }
      break
    }
    out.unshift(items[i])
    used += lines
  }
  return out
}

const Markdown = memo(function Markdown({ text }: { text: string }) {
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
})

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
          {it.kind === "system" && <Text dimColor>→ {it.text}</Text>}
        </Box>
      ))}
    </Box>
  )
}
