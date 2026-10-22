import { test, expect, beforeEach } from "bun:test"
import { editTool } from "./edit"
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"

const DIR = "/tmp/opencode/tool-edit"
const F = `${DIR}/a.txt`
beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
  writeFileSync(F, "alpha\nbeta\nalpha\n")
})

test("edit replaces unique match", async () => {
  const r = await editTool.execute({ path: F, oldString: "beta", newString: "gamma" }, { cwd: DIR })
  expect(r.error).toBeUndefined()
  expect(readFileSync(F, "utf8")).toBe("alpha\ngamma\nalpha\n")
})

test("edit with duplicate match errors, file untouched", async () => {
  const r = await editTool.execute({ path: F, oldString: "alpha", newString: "x" }, { cwd: DIR })
  expect(r.error).toBe(true)
  expect(r.output).toContain("matches 2 times")
  expect(readFileSync(F, "utf8")).toBe("alpha\nbeta\nalpha\n")
})

test("edit replaceAll replaces every match", async () => {
  await editTool.execute({ path: F, oldString: "alpha", newString: "x", replaceAll: true }, { cwd: DIR })
  expect(readFileSync(F, "utf8")).toBe("x\nbeta\nx\n")
})

test("edit result includes a diff", async () => {
  const r = await editTool.execute({ path: F, oldString: "beta", newString: "gamma" }, { cwd: DIR })
  expect(r.output).toContain("-beta")
  expect(r.output).toContain("+gamma")
})
