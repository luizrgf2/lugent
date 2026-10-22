import { test, expect, beforeEach, afterAll } from "bun:test"
import { writeTool } from "./write"
import { mkdirSync, rmSync, readFileSync } from "node:fs"

const DIR = "/tmp/opencode/tool-write"
beforeEach(() => rmSync(DIR, { recursive: true, force: true }))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))

test("write creates file and parent dirs", async () => {
  await writeTool.execute({ path: `${DIR}/a/b/c.txt`, content: "hello" }, { cwd: DIR })
  expect(readFileSync(`${DIR}/a/b/c.txt`, "utf8")).toBe("hello")
})

test("write replaces existing file entirely", async () => {
  mkdirSync(DIR, { recursive: true })
  await writeTool.execute({ path: `${DIR}/c.txt`, content: "one" }, { cwd: DIR })
  await writeTool.execute({ path: `${DIR}/c.txt`, content: "two" }, { cwd: DIR })
  expect(readFileSync(`${DIR}/c.txt`, "utf8")).toBe("two")
})
