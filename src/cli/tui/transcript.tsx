import { memo } from "react"
import { Box, Text, useStdout } from "ink"
import { parseMarkdown, type Seg } from "./markdown"
import { glyph } from "../ui"
import { LOGO_ROWS, WORDMARK_ROWS, WORDMARK_SPLIT, logoHex } from "../logo"
import type { Message } from "../../core/types"

export type TItem = { kind: "user" | "reasoning" | "tool" | "assistant" | "error" | "system" | "logo"; text: string; tool?: string }

/** Map stored history to transcript items on resume (reasoning is never persisted). */
export function itemsFromHistory(messages: Message[]): TItem[] {
  const callInfo = new Map<string, { name: string; args: unknown }>()
  for (const m of messages) for (const tc of m.toolCalls ?? []) callInfo.set(tc.id, tc)
  const out: TItem[] = []
  for (const m of messages) {
    if (m.role === "user" && m.content) out.push({ kind: "user", text: m.content.replace(/@(\S+\.(?:png|jpe?g|gif|webp))/gi, "🖼 $1") })
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
  // Every kind renders its raw \n as real rows (ink Text breaks lines), so
  // every kind counts them — counting only assistant let reasoning/system
  // multiline items overflow the window and scroll history off the screen.
  return Math.max(1, it.text.split("\n").length)
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
  const scrolled = skipBottom > 0   // the walk below mutates skipBottom
  const push = (it: TItem, text?: string) => {
    if (out.length > 0) used += 1   // blank separator line before each item
    used += itemLines(it)
    out.unshift(text === undefined ? it : { ...it, text })
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const lines = itemLines(items[i])
    if (skipBottom > 0) {
      const skip = Math.min(lines, skipBottom)
      skipBottom -= skip
      if (skip === lines) continue              // fully hidden
      // straddles the hidden tail: show its head, capped to the window
      const head = items[i].text.split("\n").slice(0, lines - skip)
      const shown = head.length > maxLines ? head.slice(head.length - maxLines) : head
      push(items[i], shown.join("\n"))
      continue
    }
    if (used + lines + (out.length > 0 ? 1 : 0) > maxLines) {
      const room = maxLines - used - (out.length > 0 ? 1 : 0)
      if (out.length === 0 && room > 0) {
        push(items[i], items[i].text.split("\n").slice(-room).join("\n"))
      }
      break
    }
    push(items[i])
  }
  // The skip swallowed everything — scrolled past the top, or the mid-stream pin
  // compensation outgrew the item. Fall back to the oldest lines (head window)
  // instead of rendering a blank transcript.
  if (out.length === 0 && scrolled) {
    for (const it of items) {
      const lines = itemLines(it)
      if (used + lines + (out.length > 0 ? 1 : 0) > maxLines) {
        const room = maxLines - used - (out.length > 0 ? 1 : 0)
        if (room > 0) out.push({ ...it, text: it.text.split("\n").slice(0, room).join("\n") })
        break
      }
      if (out.length > 0) used += 1
      used += lines
      out.push(it)
    }
  }
  return out
}

// The big L-mark + wordmark, as a scrollback item: ink prints it once at the
// very top of the conversation (<Static>), where the terminal's own scrollback
// keeps it — the live frame must never re-render it (that showed the logo
// between history and every new turn). Same rows/colors as LogoMark.
// Centered via an explicit width: <Static> renders OUTSIDE the frame, so its
// subtree is measured at its own content width (35 = the wordmark) and
// alignItems="center" alone would only center inside that — flush-left on
// screen (the splash logo stays centered because it lives INSIDE the frame,
// which spans the terminal). Forcing the box to the real terminal width
// restores the same per-row centering as the splash LogoMark.
function LogoItem() {
  const cyan = logoHex(LOGO_ROWS.length - 1)
  const cols = (useStdout().stdout as any)?.columns ?? 80
  return (
    <Box flexDirection="column" alignItems="center" width={cols}>
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

const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {parseMarkdown(text).map((line: Seg[], i: number) => (
        <Text key={i} dimColor={line.some(s => s.sep)}>
          {line.map((s: Seg, j: number) => (
            <Text
              key={j}
              bold={s.bold}
              color={s.marker ? "cyan" : s.code ? "magenta" : s.header === 1 ? "cyan" : s.header ? "green" : undefined}
            >
              {s.header ? ` ${s.text}` : s.code ? ` ${s.text} ` : s.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
})

/** One rendered item — shared by the live frame and the <Static> scrollback. */
export function TranscriptItem({ it, marginTop }: { it: TItem; marginTop?: boolean }) {
  // flexShrink 0: inside the fixed-height window the Yoga default lets a tall
  // item be shrunk and sliced mid-row; the item must keep its real height and
  // let the window clip it instead.
  return (
    <Box flexDirection="column" flexShrink={0} marginTop={marginTop ? 1 : 0}>
      {it.kind === "logo" && <LogoItem />}
      {it.kind === "user" && <Text color="blue">&gt; {it.text}</Text>}
      {it.kind === "reasoning" && (
        <Box flexDirection="column" marginBottom={1}>
          <Text italic dimColor>… pensando</Text>
          <Box paddingLeft={2}>
            <Text italic dimColor>{it.text}</Text>
          </Box>
        </Box>
      )}
      {it.kind === "tool" && <Text color="yellow">{glyph(it.tool ?? "")} {it.tool} {it.text}</Text>}
      {it.kind === "assistant" && <Markdown text={it.text} />}
      {it.kind === "error" && <Text color="red">error: {it.text}</Text>}
      {it.kind === "system" && <Text dimColor>→ {it.text}</Text>}
    </Box>
  )
}

export function Transcript({ items }: { items: TItem[] }) {
  // flexShrink 0: the window that holds this is fixed-height and clips, so the
  // block must keep its real height — shrunk, its top-aligned overflow shows
  // the oldest lines and hides the newest.
  return (
    <Box flexDirection="column" flexShrink={0}>
      {items.map((it, i) => (
        <TranscriptItem key={i} it={it} marginTop={i > 0} />
      ))}
    </Box>
  )
}
