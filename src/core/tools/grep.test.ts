import { test, expect, beforeAll, afterAll } from "bun:test"
import { grepTool } from "./grep"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"

const DIR = "/tmp/opencode/tool-grep"
beforeAll(() => {
  mkdirSync(`${DIR}/nested`, { recursive: true })
  writeFileSync(`${DIR}/nested/a.ts`, "const timeout = 30\nconst other = 1\n")
  writeFileSync(`${DIR}/b.ts`, "timeout: 60\n")
})
afterAll(() => rmSync(DIR, { recursive: true, force: true }))

test("grep finds matches with path:line:preview", async () => {
  const r = await grepTool.execute({ pattern: "timeout" }, { cwd: DIR })
  expect(r.output).toContain("nested/a.ts")
  expect(r.output).toContain("timeout = 30")
  expect(r.output).toContain("b.ts")
})

test("grep literal mode does not interpret regex", async () => {
  const r = await grepTool.execute({ pattern: "timeou.*", literal: true }, { cwd: DIR })
  expect(r.output).not.toContain("timeout")   // literal dot-star matches nothing
})

test("grep respects limit", async () => {
  const r = await grepTool.execute({ pattern: "const|timeout", limit: 1 }, { cwd: DIR })
  expect(r.output.split("\n").filter(Boolean).length).toBe(1)
})
