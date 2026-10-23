import { test, expect } from "bun:test"
import { renderTui } from "./harness"
import { AgentPicker } from "./agent-picker"

const agents = [
  { id: "reviewer", prompt: "r", description: "Reviews read-only" },
  { id: "team/audit", prompt: "a" },
]

test("picker shows id and description", async () => {
  const { lastFrame } = renderTui(<AgentPicker agents={agents} onClose={() => {}} />)
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("reviewer")
  expect(f).toContain("Reviews read-only")
  expect(f).toContain("team/audit")
})

test("down arrow moves the pointer, enter picks the selected agent", async () => {
  let picked = ""
  const { type, lastFrame } = renderTui(<AgentPicker agents={agents} onPick={a => { picked = a.id }} onClose={() => {}} />)
  await new Promise(r => setTimeout(r, 30))
  type("\u001b[B")
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toMatch(/❯ team\/audit/)
  type("\r")
  await new Promise(r => setTimeout(r, 60))
  expect(picked).toBe("team/audit")
})

test("escape closes without picking", async () => {
  let closed = 0
  let picked = ""
  const { type } = renderTui(<AgentPicker agents={agents} onPick={a => { picked = a.id }} onClose={() => { closed++ }} />)
  await new Promise(r => setTimeout(r, 30))
  type("\u001b")
  await new Promise(r => setTimeout(r, 60))
  expect(closed).toBe(1)
  expect(picked).toBe("")
})

test("empty list renders the hint", async () => {
  const { lastFrame } = renderTui(<AgentPicker agents={[]} onClose={() => {}} />)
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("no agents")
})
