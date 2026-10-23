import { test, expect } from "bun:test"
import { box, truncate, glyph, frames, padLine } from "./ui"

test("box wraps lines with borders and title", () => {
  const out = box("lugent", ["one", "two"])
  const lines = out.split("\n")
  expect(lines[0]).toBe("┌─ lugent ─┐")
  expect(lines[1]).toBe("│ one      │")
  expect(lines[2]).toBe("│ two      │")
  expect(lines[3]).toBe("└──────────┘")
  // every line is the same visual width
  expect(new Set(lines.map((l) => [...l].length)).size).toBe(1)
})

test("box pads lines of different length", () => {
  const out = box("t", ["short", "a-very-long-line"])
  const lines = out.split("\n")
  expect(lines[1]).toBe("│ short            │")
  expect(lines[2]).toBe("│ a-very-long-line │")
  expect(new Set(lines.map((l) => [...l].length)).size).toBe(1)
})

test("truncate long strings with ellipsis, keeps short ones", () => {
  expect(truncate("abc", 5)).toBe("abc")
  expect(truncate("abcdefgh", 5)).toBe("abcd…")
})

test("glyph maps tool names to symbols", () => {
  expect(glyph("read")).toBe("▸")
  expect(glyph("edit")).toBe("✎")
  expect(glyph("write")).toBe("+")
  expect(glyph("shell")).toBe("$")
  expect(glyph("grep")).toBe("⌕")
  expect(glyph("glob")).toBe("✳")
  expect(glyph("skill")).toBe("★")
  expect(glyph("unknown-tool")).toBe("⚙")
})

test("frames advance and cycle", () => {
  expect(frames.length).toBeGreaterThan(4)
  expect(frames[0]).not.toBe(frames[1])
})

test("padLine pads to width with side borders", () => {
  expect(padLine("hi", 8)).toBe("│ hi       │")
})