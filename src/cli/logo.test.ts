import { test, expect } from "bun:test"
import { LOGO_HEIGHT, LOGO_ROWS, logoHex, logoAnsi, logoTopPad } from "./logo"

test("logoTopPad centers the mark on the splash screen, without overflow", () => {
  // Upper pad = half the rows left over by the mark, so mark + pad is centered
  // in the viewport (30 rows, mark at 9..20 → center 14.5).
  expect(logoTopPad(30)).toBe(9)
  expect(logoTopPad(40)).toBe(14)
  expect(logoTopPad(24)).toBe(6)
  // Capped by the room left above the chrome: pad + logo + chrome ≤ rows.
  expect(logoTopPad(20)).toBe(3)
  expect(logoTopPad(17)).toBe(0)
  expect(logoTopPad(12)).toBe(0)
  expect(logoTopPad(10)).toBe(0)   // shorter than the chrome: never negative
})

test("rendered logo height covers raster + wordmark + margin", () => {
  // The TUI subtracts LOGO_HEIGHT from the terminal rows to size the
  // transcript window — 12, not 11, or every frame is 1 line taller than
  // the screen and history scrolls off (logo painted into scrollback).
  expect(LOGO_HEIGHT).toBe(LOGO_ROWS.length + 2)
  expect(LOGO_HEIGHT).toBe(12)
})

test("raster geometry mirrors the svg mark", () => {
  expect(LOGO_ROWS).toHaveLength(10)
  expect(LOGO_ROWS[0].startsWith("██▄")).toBe(true)        // chevron head, top-left
  expect(LOGO_ROWS[4]).toContain("●")                      // agent dot mid-mark
  expect(LOGO_ROWS[8]).toMatch(/^▄+$/)                     // base bar (lower half-blocks)
  expect(LOGO_ROWS[9]).toMatch(/^▀+$/)                     // base bar (upper half-blocks)
})

test("raster rows are equal width", () => {
  expect(new Set(LOGO_ROWS.map(l => [...l].length)).size).toBe(1)
})

test("hex gradient samples the svg diagonal (monotonic green → cyan)", () => {
  const top = logoHex(0)
  const bottom = logoHex(LOGO_ROWS.length - 1)
  expect(top).toBe("#00f5a0")   // svg gradient start
  expect(bottom).toBe("#00d9f5") // svg gradient end
  // monotonic: G falls, B rises row by row (the svg gradient direction)
  for (let i = 1; i < LOGO_ROWS.length; i++) {
    const [r0, g0, b0] = hexRgb(logoHex(i - 1))
    const [r1, g1, b1] = hexRgb(logoHex(i))
    expect(r1).toBe(r0)
    expect(g1).toBeLessThanOrEqual(g0)
    expect(b1).toBeGreaterThanOrEqual(b0)
  }
})

test("ansi codes use the same svg stops", () => {
  expect(logoAnsi(0)).toBe("\x1b[38;2;0;245;160m")
  expect(logoAnsi(9)).toBe("\x1b[38;2;0;217;245m")
})

function hexRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}
