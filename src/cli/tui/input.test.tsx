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
