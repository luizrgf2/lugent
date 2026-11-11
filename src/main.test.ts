import { test, expect } from "bun:test"
import { $ } from "bun"

test("non-TTY (piped) stdin runs REPL fallback path", async () => {
  const out = await $`printf '/exit\n' | bun src/main.ts --db /tmp/opencode/tui-smoke.db`.quiet().text()
  expect(out).toContain("/model")   // REPL hint line, not TUI frame — pins the isTTY auto-fallback
}, 30000)

const USAGE = "usage: lugent [--plain] [--db <path>] [--version]"

test("--db with no value: usage error on stderr, exit 2, no traceback", async () => {
  const r = await $`bun src/main.ts --db`.nothrow().quiet()
  const stderr = r.stderr.toString()
  expect(r.exitCode).toBe(2)
  expect(stderr).toContain("lugent: --db needs a path")
  expect(stderr).toContain(USAGE)
  expect(stderr).not.toContain("TypeError")
}, 30000)

test("--db followed by a flag is not taken as the path", async () => {
  const dir = `${import.meta.dir}/__dbflag_tmp__`
  await $`mkdir -p ${dir}`.quiet()
  const r = await $`bun ${import.meta.dir}/main.ts --db --plain`.cwd(dir).nothrow().quiet()
  const created = await $`ls ${dir}`.quiet().text()
  await $`rm -rf ${dir}`.quiet()
  expect(r.exitCode).toBe(2)
  expect(r.stderr.toString()).toContain("lugent: --db needs a path")
  expect(created.trim()).toBe("")   // no file named "--plain"
}, 30000)

test("--db with an empty string is rejected", async () => {
  const r = await $`bun src/main.ts --db ""`.nothrow().quiet()
  expect(r.exitCode).toBe(2)
  expect(r.stderr.toString()).toContain("lugent: --db needs a path")
}, 30000)
