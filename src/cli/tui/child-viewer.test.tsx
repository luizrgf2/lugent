import { test, expect } from "bun:test"
import { renderTui } from "./harness"
import { ChildPicker, subagentLine, decorateSubagents, type ChildInfo } from "./child-viewer"
import type { TItem } from "./transcript"

const kid = (over: Partial<ChildInfo> = {}): ChildInfo =>
  ({ sessionId: "ses_k1", agent: "reviewer", status: "running", startedAt: 10_000, ...over })

const subItem = (over: Partial<TItem> = {}): TItem =>
  ({ kind: "tool", tool: "subagent", text: "reviewer", sub: "ses_k1", ...over } as TItem)

test("subagentLine renders agent · activity · elapsed while the child runs", () => {
  const line = subagentLine(subItem(), [kid({ activity: "read a.txt" })], 13_000)
  expect(line.text).toBe("reviewer · read a.txt · 3s")
})

test("subagentLine falls back to thinking when the child has no activity yet", () => {
  const line = subagentLine(subItem(), [kid({})], 10_400)
  expect(line.text).toBe("reviewer · thinking · 0s")
})

test("subagentLine leaves the plain line for done children, unknown ids and other items", () => {
  const done = subagentLine(subItem(), [kid({ status: "done" })], 99_000)
  expect(done.text).toBe("reviewer")
  const unknown = subagentLine(subItem({ sub: "ses_other" }), [kid()], 99_000)
  expect(unknown.text).toBe("reviewer")
  const plain: TItem = { kind: "tool", tool: "read", text: "a.txt" }
  expect(subagentLine(plain, [kid()], 99_000)).toBe(plain)
  const unlinked: TItem = { kind: "tool", tool: "subagent", text: "reviewer" }
  expect(subagentLine(unlinked, [kid()], 99_000)).toBe(unlinked)
})

test("decorateSubagents is identity without children and maps every subagent item", () => {
  const items: TItem[] = [
    { kind: "tool", tool: "subagent", text: "reviewer", sub: "ses_k1" } as TItem,
    { kind: "tool", tool: "read", text: "b.txt" },
    { kind: "tool", tool: "subagent", text: "auditor", sub: "ses_k2" } as TItem,
  ]
  expect(decorateSubagents(items, [], 99_000)).toBe(items)
  const out = decorateSubagents(items, [
    kid({ activity: "writing" }),
    kid({ sessionId: "ses_k2", agent: "auditor", activity: "grep x" }),
  ], 11_500)
  expect(out[0].text).toBe("reviewer · writing · 1s")
  expect(out[1].text).toBe("b.txt")           // untouched
  expect(out[2].text).toBe("auditor · grep x · 1s")
})

test("ChildPicker lists children, picks with enter, closes with esc", async () => {
  const picks: number[] = []
  let closed = false
  const { type, lastFrame } = renderTui(<ChildPicker
    kids={[kid(), kid({ sessionId: "ses_k2", agent: "auditor", status: "done" })]}
    onPick={i => picks.push(i)}
    onClose={() => { closed = true }} />)
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("choose child")
  expect(lastFrame()).toContain("1 · reviewer · running")
  expect(lastFrame()).toContain("2 · auditor")
  type("\x1b[B")   // down
  type("\r")       // pick
  await new Promise(r => setTimeout(r, 30))
  expect(picks).toEqual([1])
  type("\x1b")
  await new Promise(r => setTimeout(r, 30))
  expect(closed).toBe(true)
})

test("ChildPicker windows past 8 children like the agent picker", async () => {
  const kids = Array.from({ length: 10 }, (_, i) => kid({ sessionId: `ses_k${i}`, agent: `s${i}` }))
  const { type, lastFrame } = renderTui(<ChildPicker kids={kids} onPick={() => {}} onClose={() => {}} />)
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("1 · s0")
  expect(lastFrame()).not.toContain("10 · s9")   // windowed to 8 rows
  for (let i = 0; i < 9; i++) type("\x1b[B")     // down to the last child
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("10 · s9")       // window scrolled to the tail
  expect(lastFrame()).not.toContain("1 · s0")
})
