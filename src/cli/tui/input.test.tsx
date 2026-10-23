import { test, expect } from "bun:test"
import { renderTui } from "./harness"
import { Input } from "./input"

test("enter submits, empty submit is a no-op", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={(t) => got.push(t)} />)
  type("hi\r")
  await new Promise(r => setTimeout(r, 30))
  type("\r")      // empty
  type("  \r")    // whitespace
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["hi"])
  expect(lastFrame()).not.toContain("hi")   // cleared after submit
})

test("up arrow recalls last submitted input", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={(t) => got.push(t)} />)
  type("one\r")
  await new Promise(r => setTimeout(r, 30))
  type("\u001b[A")   // ↑
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("one")
})

test("disabled input ignores keys", async () => {
  const got: string[] = []
  const { type } = renderTui(<Input disabled={true} onSubmit={(t) => got.push(t)} />)
  type("x\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual([])
})

test("ctrl keys are not typed as characters", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={(t) => got.push(t)} />)
  type("ab\x03")   // a, b, ctrl+c
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual([])
  expect(lastFrame()).not.toContain("c")   // ctrl+c never becomes a character
})

const CMDS = [
  { cmd: "exit", desc: "quit lugent" },
  { cmd: "model", desc: "switch provider/model" },
  { cmd: "skills", desc: "browse skills" },
]

test("/ lists commands, prefix filters as you type", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} completions={CMDS} />)
  type("/")
  await new Promise(r => setTimeout(r, 30))
  const all = lastFrame()
  expect(all).toContain("/exit"); expect(all).toContain("/model"); expect(all).toContain("/skills")
  expect(all).toContain("quit lugent"); expect(all).toContain("browse skills")
  type("mo")
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("/model"); expect(f).toContain("switch provider/model")
  expect(f).not.toContain("/exit"); expect(f).not.toContain("/skills")
})

test("tab completes the selected command and submits", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} completions={CMDS} />)
  type("/mo\t\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["/model"])
})

test("arrows navigate suggestions, not history, while open", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} completions={CMDS} />)
  type("older\r")
  await new Promise(r => setTimeout(r, 30))
  type("/e\u001b[A\t\r")   // ↑ with suggestions open: must NOT recall "older"
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["older", "/exit"])
})

test("enter picks the highlighted suggestion, not the raw prefix", async () => {
  const got: string[] = []
  const { type } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} completions={CMDS} />)
  type("/\u001b[B\r")   // open list, ↓ to /model, enter
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["/model"])
})

test("enter submits while suggestions open, box clears", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} completions={CMDS} />)
  type("/model\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["/model"])
  expect(lastFrame()).not.toContain("switch provider/model")   // suggestions gone
})

test("no prefix match hides suggestions", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} completions={CMDS} />)
  type("/x")
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("/x")
  expect(f).not.toContain("/exit"); expect(f).not.toContain("/model"); expect(f).not.toContain("/skills")
})
