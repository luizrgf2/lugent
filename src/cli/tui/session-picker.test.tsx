import { test, expect } from "bun:test"
import { renderTui } from "./harness"
import { SessionPicker } from "./session-picker"

const sessions = [
  { id: "ses_aaaa1111-1111", provider: "9router", model: "glm/glm-5.2", createdAt: "2026-10-23T10:00:00.000Z", preview: "fix the login bug" },
  { id: "ses_bbbb2222-2222", provider: "ollama", model: "qwen3.5:14b", createdAt: "2026-10-22T09:00:00.000Z", preview: "write a parser" },
]

test("renders id, model and preview per session", async () => {
  const { lastFrame } = renderTui(<SessionPicker sessions={sessions} onPick={() => {}} onClose={() => {}} />)
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("ses_aaaa")
  expect(f).toContain("glm/glm-5.2")
  expect(f).toContain("fix the login bug")
  expect(f).toContain("write a parser")
})

test("enter picks, escape closes", async () => {
  let picked: string | null = null
  let closed = 0
  const { type } = renderTui(
    <SessionPicker sessions={sessions} onPick={id => { picked = id }} onClose={() => { closed++ }} />,
  )
  await new Promise(r => setTimeout(r, 30))
  type("\r")
  await new Promise(r => setTimeout(r, 40))
  expect(picked).toBe("ses_aaaa1111-1111")
  type("\u001b")
  await new Promise(r => setTimeout(r, 60))
  expect(closed).toBe(1)
})

test("empty list shows hint and enter closes", async () => {
  let closed = 0
  const { type, lastFrame } = renderTui(<SessionPicker sessions={[]} onPick={() => {}} onClose={() => { closed++ }} />)
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("no sessions in this directory")
  type("\r")
  await new Promise(r => setTimeout(r, 60))
  expect(closed).toBe(1)
})
