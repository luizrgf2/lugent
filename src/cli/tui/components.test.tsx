import { test, expect } from "bun:test"
import { renderTui } from "./harness"
import { Status, Spinner, ContextLine } from "./status"
import { Transcript } from "./transcript"

test("status shows provider, model, short session, OFF warn", () => {
  const { lastFrame } = renderTui(
    <Status provider="9router" model="glm/glm-5.2" sessionId="ses_12345678-abc" off={["9router"]} busy={false} />
  )
  const f = lastFrame()
  expect(f).toContain("9router · glm/glm-5.2")
  expect(f).toContain("ses_1234")
  expect(f).toContain("OFF")
})

test("status centers the LUGENT mark between left info and right session", () => {
  const { lastFrame } = renderTui(
    <Status provider="9router" model="glm/glm-5.2" sessionId="ses_12345678-abc" off={[]} busy={false} />
  )
  const f = lastFrame()
  expect(f).toContain("▟▙ LUGENT")            // centered mark
  const markAt = f.indexOf("▟▙ LUGENT")
  expect(f.indexOf("9router")).toBeLessThan(markAt)   // left info first
  expect(f.indexOf("ses_1234")).toBeGreaterThan(markAt) // session right of mark
})

test("status busy shows working indicator", () => {
  const { lastFrame } = renderTui(
    <Status provider="p" model="m" sessionId="ses_12345678-abc" off={[]} busy={true} />
  )
  expect(lastFrame()).toContain("working")
})

test("spinner hidden when idle, animates while busy", async () => {
  const idle = renderTui(<Spinner busy={false} />)
  expect(idle.lastFrame()).not.toContain("working…")
  idle.unmount()

  const { lastFrame, unmount } = renderTui(<Spinner busy={true} />)
  const a = lastFrame()
  expect(a).toContain("working…")
  await new Promise(r => setTimeout(r, 120))   // > one frame tick (80ms)
  const b = lastFrame()
  expect(b).toContain("working…")
  expect(b).not.toBe(a)                        // glyph advanced
  unmount()
})

test("transcript renders kinds distinctly", () => {
  const items = [
    { kind: "user" as const, text: "do it" },
    { kind: "reasoning" as const, text: "thinking aloud" },
    { kind: "tool" as const, tool: "read", text: "src/main.ts" },
    { kind: "assistant" as const, text: "done **now**" },
    { kind: "error" as const, text: "boom" },
  ]
  const { lastFrame } = renderTui(<Transcript items={items} />)
  const f = lastFrame()
  expect(f).toContain("do it")
  expect(f).toContain("… pensando")
  expect(f).toContain("thinking aloud")
  expect(f).toContain("▸ read src/main.ts")
  expect(f).toContain("done now")
  expect(f).toContain("boom")
})

test("reasoning block sits above blank margin, indented from label", () => {
  const items = [
    { kind: "user" as const, text: "q" },
    { kind: "reasoning" as const, text: "step" },
    { kind: "assistant" as const, text: "a" },
  ]
  const { lastFrame } = renderTui(<Transcript items={items} />)
  const f = lastFrame()
  const label = f.indexOf("… pensar")
  const body = f.indexOf("step")
  expect(body).toBeGreaterThan(label)        // body below label
  expect(f.slice(body - 2, body)).toBe("  ") // paddingLeft 2 indent
})

test("assistant markdown renders as aligned table with separator", () => {
  const { lastFrame } = renderTui(<Transcript items={[{ kind: "assistant", text: "| h | t |\n| --- | --- |\n| cell | x |" }]} />)
  const f = lastFrame()
  expect(f).toContain("h    ")   // padded interior column
  expect(f).toContain("│")       // column separator
  expect(f).toContain("cell")
})

test("assistant markdown renders list markers", () => {
  const { lastFrame } = renderTui(<Transcript items={[{ kind: "assistant", text: "- one\n- two" }]} />)
  expect(lastFrame()).toContain("•")
})

test("transcript renders assistant markdown: fence and inline code", () => {
  const { lastFrame } = renderTui(<Transcript items={[{ kind: "assistant", text: "see `x` and\n```\nlet y = 2\n```" }]} />)
  const f = lastFrame()
  expect(f).toContain("x")
  expect(f).toContain("let y = 2")
  expect(f).not.toContain("```")
})

test("status shows the selected agent when set", async () => {
  const { lastFrame } = renderTui(
    <Status provider="p" model="m" sessionId="ses_12345678-abc" off={[]} busy={false} yolo={false} agent="reviewer" />
  )
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("reviewer")
})

test("context line: AGENTS.md loaded (yellow) + current agent with its color", async () => {
  const none = renderTui(<ContextLine agent={undefined} agentsMd={null} />)
  await new Promise(r => setTimeout(r, 30))
  expect(none.lastFrame()).not.toContain("AGENTS.md")
  expect(none.lastFrame()).not.toContain("agent")

  const loaded = renderTui(<ContextLine agent={{ id: "build", color: "magenta", prompt: "p" }} agentsMd="rules" />)
  await new Promise(r => setTimeout(r, 30))
  const f = loaded.lastFrame()
  expect(f).toContain("AGENTS.md loaded")
  expect(f).toContain("build")
})
