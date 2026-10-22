import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { parseFrontmatter, loadSkills, readSkillBody } from "./skills"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"

const ROOT = "/tmp/opencode/skills-proj"

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(`${ROOT}/.agents/skills/git-release`, { recursive: true })
  writeFileSync(`${ROOT}/.agents/skills/git-release/SKILL.md`,
    `---\nname: Git Release\ndescription: Prepare releases\n---\n\n## Workflow\n1. Read policy.`)
  writeFileSync(`${ROOT}/.agents/skills/review.md`,
    `---\ndescription: Review diffs\n---\nReview carefully.`)
  writeFileSync(`${ROOT}/.agents/skills/no-desc.md`, `No frontmatter here.`)
})
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

test("parseFrontmatter splits data and body", () => {
  const { data, body } = parseFrontmatter(`---\nname: X\ndescription: Y\n---\n\nBody text`)
  expect(data.name).toBe("X")
  expect(data.description).toBe("Y")
  expect(body).toBe("\nBody text")
})

test("parseFrontmatter without frontmatter returns empty data", () => {
  const { data, body } = parseFrontmatter(`just text`)
  expect(data).toEqual({})
  expect(body).toBe("just text")
})

test("loadSkills: nested dir + flat file, id from path, no-description excluded", () => {
  const skills = loadSkills(ROOT)
  const ids = skills.map(s => s.id)
  expect(ids).toContain("git-release")
  expect(ids).toContain("review")
  expect(ids).not.toContain("no-desc")   // no description → not advertised
  const gr = skills.find(s => s.id === "git-release")!
  expect(gr.name).toBe("Git Release")
  expect(gr.description).toBe("Prepare releases")
})

test("readSkillBody returns body without frontmatter", () => {
  const skills = loadSkills(ROOT)
  const body = readSkillBody(skills.find(s => s.id === "git-release")!)
  expect(body).toContain("## Workflow")
  expect(body).not.toContain("description:")
})
