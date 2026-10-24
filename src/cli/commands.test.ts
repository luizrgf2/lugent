import { test, expect } from "bun:test"
import { parseSlash, parseAnswer, mcpActions, formatMcpState } from "./commands"

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

test("mcpActions: one action set per status, and logout only for a remote server", () => {
  expect(mcpActions("connected", "remote")).toEqual(["logout", "disable"])
  expect(mcpActions("connected", "local")).toEqual(["disable"])
  expect(mcpActions("disabled", "remote")).toEqual(["enable"])
  expect(mcpActions("failed", "remote")).toEqual(["reconnect", "disable"])
  expect(mcpActions("auth_required", "remote")).toEqual(["authenticate", "disable"])
})

test("formatMcpState: tool count when connected, error when failed", () => {
  expect(formatMcpState({ name: "a", type: "local", status: "connected", toolCount: 1 }))
    .toBe("a (local) — connected, 1 tool")
  expect(formatMcpState({ name: "b", type: "remote", status: "failed", error: "boom", toolCount: 0 }))
    .toBe("b (remote) — failed: boom")
  expect(formatMcpState({ name: "c", type: "remote", status: "disabled", toolCount: 0 }))
    .toBe("c (remote) — disabled")
})

test("formatMcpState: auth_required reads as needs authentication", () => {
  expect(formatMcpState({ name: "tf", type: "remote", status: "auth_required", toolCount: 0 }))
    .toBe("tf (remote) — auth_required: needs authentication")
  expect(formatMcpState({ name: "tf", type: "remote", status: "auth_required", error: "denied", toolCount: 0 }))
    .toBe("tf (remote) — auth_required: needs authentication — denied")
})
