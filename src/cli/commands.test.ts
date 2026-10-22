import { test, expect } from "bun:test"
import { parseSlash, parseAnswer } from "./commands"

test("plain message is not a command", () => {
  expect(parseSlash("hello world")).toBeNull()
})

test("slash command with args", () => {
  expect(parseSlash("/model local qwen")).toEqual({ cmd: "model", args: ["local", "qwen"] })
})

test("slash command without args", () => {
  expect(parseSlash("/skills")).toEqual({ cmd: "skills", args: [] })
})

test("parseAnswer: only explicit y/a allows (review F3)", () => {
  expect(parseAnswer("y")).toBe("y")
  expect(parseAnswer("Y")).toBe("y")
  expect(parseAnswer("yes")).toBe("y")
  expect(parseAnswer("a")).toBe("a")
  expect(parseAnswer("always")).toBe("a")
  expect(parseAnswer("")).toBe("n")        // Enter must NOT default to allow
  expect(parseAnswer("n")).toBe("n")
  expect(parseAnswer("garbage")).toBe("n")
  expect(parseAnswer("\n")).toBe("n")
})
