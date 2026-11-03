import { test, expect } from "bun:test"
import { makeSubagentTool } from "./subagent"
import { makeTools } from "./index"

test("subagent tool delegates to ctx.spawn", async () => {
  const calls: Array<{ agent: string; prompt: string }> = []
  const tool = makeSubagentTool()
  const r = await tool.execute({ agent: "reviewer", prompt: "review the diff" }, {
    cwd: "/x",
    spawn: async (agent, prompt) => { calls.push({ agent, prompt }); return { output: "done" } },
  })
  expect(calls).toEqual([{ agent: "reviewer", prompt: "review the diff" }])
  expect(r.output).toBe("done")
})

test("subagent tool is ask and errors without a spawn", async () => {
  const tool = makeSubagentTool()
  expect(tool.permission).toBe("ask")
  const r = await tool.execute({ agent: "x", prompt: "y" }, { cwd: "/x" })
  expect(r.error).toBe(true)
})

test("makeTools registers subagent", () => {
  expect(makeTools("/x").map(t => t.name)).toContain("subagent")
})
