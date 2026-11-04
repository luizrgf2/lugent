import { useRef, useState } from "react"
import { Box, Text, useInput, useStdout } from "ink"
import { clampItems, Transcript, type TItem } from "./transcript"
import { transcriptWindow } from "../logo"

export interface ChildInfo {
  sessionId: string
  agent: string
  status: "running" | "done"
  startedAt: number
  activity?: string
}

/**
 * Live text for a `subagent` tool item while its child runs: agent id ·
 * current activity · elapsed seconds. Done children (and anything not tied to
 * a known running child) keep the plain completed tool line.
 */
export function subagentLine(it: TItem, kids: ChildInfo[], now: number): TItem {
  if (it.kind !== "tool" || it.tool !== "subagent" || !it.sub) return it
  const kid = kids.find(k => k.sessionId === it.sub)
  if (!kid || kid.status === "done") return it
  const secs = Math.max(0, Math.floor((now - kid.startedAt) / 1000))
  return { ...it, text: `${kid.agent} · ${kid.activity || "thinking"} · ${secs}s` }
}

export function decorateSubagents(items: TItem[], kids: ChildInfo[], now: number): TItem[] {
  return kids.length ? items.map(it => subagentLine(it, kids, now)) : items
}

/**
 * Read-only live view of one child session (ctrl+N), rendered in place of the
 * parent's live transcript and windowed by the same budget — the frame is
 * fixed-height, so the child transcript can never push the composer around.
 */
export function ChildViewer(p: { index: number; total: number; info: ChildInfo; items: TItem[]; onClose(): void }) {
  useInput((_input, key) => { if (key.escape) p.onClose() })
  const rows = (useStdout().stdout as any)?.rows ?? 24
  const visible = clampItems(p.items, transcriptWindow(rows))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text dimColor>subagent {p.index + 1}/{p.total} · {p.info.agent} · {p.info.status}</Text>
      {visible.length === 0 ? <Text dimColor>(no activity yet)</Text> : <Transcript items={visible} />}
      <Text dimColor>esc close · ctrl+1..9 other child</Text>
    </Box>
  )
}

const MAX_VISIBLE = 8

/** ctrl+9 past 8 children: same windowed-list pattern as the agent picker. */
export function ChildPicker(p: { kids: ChildInfo[]; onPick(i: number): void; onClose(): void }) {
  const [sel, setSel] = useState(0)
  const selRef = useRef(0)
  const setSelBoth = (i: number) => { selRef.current = i; setSel(i) }

  useInput((_input, key) => {
    if (key.upArrow) { setSelBoth(Math.max(0, selRef.current - 1)); return }
    if (key.downArrow) { setSelBoth(Math.min(p.kids.length - 1, selRef.current + 1)); return }
    if (key.return) { if (p.kids[selRef.current]) p.onPick(selRef.current); return }
    if (key.escape) p.onClose()
  })

  const start = sel < MAX_VISIBLE ? 0 : sel - MAX_VISIBLE + 1
  const view = p.kids.slice(start, start + MAX_VISIBLE)

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text dimColor>subagents · choose child</Text>
      {view.map((k, i) => {
        const idx = start + i
        return (
          <Text key={k.sessionId} color={idx === sel ? "cyan" : undefined}>
            {idx === sel ? "❯" : " "} {idx + 1} · {k.agent}{k.status === "running" ? " · running" : ""}
          </Text>
        )
      })}
      <Text dimColor>↑/↓ move · enter select · esc cancel</Text>
    </Box>
  )
}
