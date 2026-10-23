import { test, expect } from "bun:test"
import { renderTui } from "./harness"
import { Status, Spinner } from "./status"
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
  expect(f).toContain("thinking aloud")
  expect(f).toContain("▸ read src/main.ts")
  expect(f).toContain("done now")
  expect(f).toContain("boom")
})

test("transcript renders assistant markdown: fence and inline code", () => {
  const { lastFrame } = renderTui(<Transcript items={[{ kind: "assistant", text: "see `x` and\n```\nlet y = 2\n```" }]} />)
  const f = lastFrame()
  expect(f).toContain("x")
  expect(f).toContain("let y = 2")
  expect(f).not.toContain("```")
})
