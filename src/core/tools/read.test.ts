import { test, expect, beforeAll, afterAll } from "bun:test"
import { readTool } from "./read"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"

const DIR = "/tmp/opencode/tool-read"
beforeAll(() => {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(`${DIR}/a.txt`, "one\ntwo\nthree\n")
  writeFileSync(`${DIR}/bin.dat`, Buffer.from([0x00, 0x01, 0x02]))
})
afterAll(() => rmSync(DIR, { recursive: true, force: true }))

test("read file with numbered lines", async () => {
  const r = await readTool.execute({ path: `${DIR}/a.txt` }, { cwd: DIR })
  expect(r.output).toContain("1: one")
  expect(r.output).toContain("3: three")
})

test("read with offset/limit pages", async () => {
  const r = await readTool.execute({ path: `${DIR}/a.txt`, offset: 2, limit: 1 }, { cwd: DIR })
  expect(r.output.trim()).toBe("2: two")
})

test("read directory is non-recursive listing", async () => {
  const r = await readTool.execute({ path: DIR }, { cwd: DIR })
  expect(r.output).toContain("a.txt")
})

test("binary file rejected", async () => {
  const r = await readTool.execute({ path: `${DIR}/bin.dat` }, { cwd: DIR })
  expect(r.error).toBe(true)
  expect(r.output).toContain("binary")
})

test("missing file is an error result, not a throw", async () => {
  const r = await readTool.execute({ path: `${DIR}/nope.txt` }, { cwd: DIR })
  expect(r.error).toBe(true)
})
