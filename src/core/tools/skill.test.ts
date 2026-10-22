import { test, expect, beforeAll, afterAll } from "bun:test"
import { makeSkillTool } from "./skill"
import { makeTools } from "./index"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"

const ROOT = "/tmp/opencode/skill-tool"
beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(`${ROOT}/.agents/skills/rel`, { recursive: true })
  writeFileSync(`${ROOT}/.agents/skills/rel/SKILL.md`, `---\nname: Rel\ndescription: Do releases\n---\n\nStep 1: tag.`)
})
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

test("skill tool loads body by id", async () => {
  const r = await makeSkillTool(ROOT).execute({ id: "rel" }, { cwd: ROOT })
  expect(r.output).toContain("Step 1: tag.")
  expect(r.output).not.toContain("description:")
})

test("unknown skill id is an error result", async () => {
  const r = await makeSkillTool(ROOT).execute({ id: "nope" }, { cwd: ROOT })
  expect(r.error).toBe(true)
})

test("makeTools returns the 7 tools with unique names", async () => {
  const names = makeTools(ROOT).map(t => t.name)
  expect(names).toEqual(["read", "glob", "grep", "edit", "write", "shell", "skill"])
})
