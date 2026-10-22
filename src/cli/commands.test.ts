import { test, expect } from "bun:test"
import { parseSlash } from "./commands"

test("plain message is not a command", () => {
  expect(parseSlash("hello world")).toBeNull()
})

test("slash command with args", () => {
  expect(parseSlash("/model local qwen")).toEqual({ cmd: "model", args: ["local", "qwen"] })
})

test("slash command without args", () => {
  expect(parseSlash("/skills")).toEqual({ cmd: "skills", args: [] })
})
