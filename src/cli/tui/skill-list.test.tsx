import { test, expect } from "bun:test"
import { renderTui } from "./harness"
import { SkillList } from "./skill-list"

const skills = [
  { id: "git-release", name: "Git Release", description: "Prepare releases" },
  { id: "review", name: "review", description: "Review diffs" },
]

test("skill list renders id, name and description", async () => {
  const { lastFrame } = renderTui(<SkillList skills={skills} onClose={() => {}} />)
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("git-release")
  expect(f).toContain("Git Release")
  expect(f).toContain("Prepare releases")
  expect(f).toContain("review")
})

test("down arrow moves the pointer", async () => {
  const { type, lastFrame } = renderTui(<SkillList skills={skills} onClose={() => {}} />)
  await new Promise(r => setTimeout(r, 30))
  type("\u001b[B")
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toMatch(/❯ review/)
})

test("escape and enter close the list", async () => {
  let closed = 0
  const { type } = renderTui(<SkillList skills={skills} onClose={() => { closed++ }} />)
  await new Promise(r => setTimeout(r, 30))
  type("\r")
  await new Promise(r => setTimeout(r, 60))
  expect(closed).toBe(1)
  type("\u001b")
  await new Promise(r => setTimeout(r, 100))
  expect(closed).toBe(2)
})

test("long skill list windows to ~8 visible rows", async () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ id: `s${String(i).padStart(2, "0")}`, name: `s${i}`, description: `d${i}` }))
  const { type, lastFrame } = renderTui(<SkillList skills={many} onClose={() => {}} />)
  await new Promise(r => setTimeout(r, 30))
  const f1 = lastFrame()
  expect(f1).toContain("s00")
  expect(f1).not.toContain("s14")
  for (let i = 0; i < 14; i++) type("\u001b[B")
  await new Promise(r => setTimeout(r, 40))
  const f2 = lastFrame()
  expect(f2).toContain("s14")
  expect(f2).not.toContain("s00")
})
