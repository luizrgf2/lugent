import { test, expect } from "bun:test"
import { shellTool } from "./shell"

test("shell runs command and returns output", async () => {
  const r = await shellTool.execute({ command: "echo hello" }, { cwd: "/tmp/opencode" })
  expect(r.output.trim()).toBe("hello")
})

test("shell captures non-zero exit as error result", async () => {
  const r = await shellTool.execute({ command: "exit 3" }, { cwd: "/tmp/opencode" })
  expect(r.error).toBe(true)
  expect(r.output).toContain("exit code 3")
})

test("shell timeout kills the command", async () => {
  const r = await shellTool.execute({ command: "sleep 5", timeout: 100 }, { cwd: "/tmp/opencode" })
  expect(r.error).toBe(true)
  expect(r.output).toContain("timed out")
})

test("shell background returns immediately", async () => {
  const t0 = Date.now()
  const r = await shellTool.execute({ command: "sleep 1", background: true }, { cwd: "/tmp/opencode" })
  expect(Date.now() - t0).toBeLessThan(500)
  expect(r.output).toContain("background")
})
