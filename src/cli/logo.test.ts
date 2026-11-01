import { test, expect } from "bun:test"
import { CHROME_HEIGHT, LOGO_HEIGHT, LOGO_ROWS, WORDMARK_ROWS, WORDMARK_SPLIT, frameRows, logoHex, logoAnsi, logoTopPad, transcriptWindow } from "./logo"

test("logoTopPad centers the mark on the splash screen, without overflow", () => {
  // Upper pad = half the rows left over by the mark, so mark + pad is centered
  // in the viewport (30 rows: (30-16)/2 = 7, and 8 rows are left above the chrome).
  expect(logoTopPad(30)).toBe(7)
  expect(logoTopPad(40)).toBe(12)
  // The cap binds before the centering does: (24-16)/2 = 4 > the 2 rows left.
  expect(logoTopPad(24)).toBe(2)
  expect(logoTopPad(23)).toBe(1)
  // Capped by the room left above the chrome: pad + logo + chrome ≤ rows.
  expect(logoTopPad(22)).toBe(0)
  expect(logoTopPad(20)).toBe(0)
  expect(logoTopPad(17)).toBe(0)
  expect(logoTopPad(12)).toBe(0)
  expect(logoTopPad(10)).toBe(0)   // shorter than the chrome: never negative
})

test("rendered logo height covers raster + wordmark + margin", () => {
  // The TUI subtracts LOGO_HEIGHT from the terminal rows to size the
  // transcript window — 16, or every frame is taller than the screen and
  // history scrolls off (logo painted into scrollback).
  expect(LOGO_HEIGHT).toBe(LOGO_ROWS.length + WORDMARK_ROWS.length + 1)
  expect(LOGO_HEIGHT).toBe(16)
})

test("raster geometry mirrors the svg mark", () => {
  expect(LOGO_ROWS).toHaveLength(10)
  expect(LOGO_ROWS[0].startsWith("██▄")).toBe(true)        // chevron head, top-left
  expect(LOGO_ROWS[4]).toContain("●")                      // agent dot mid-mark
  expect(LOGO_ROWS[8]).toMatch(/^▄+$/)                     // base bar (lower half-blocks)
  expect(LOGO_ROWS[9]).toMatch(/^▀+$/)                     // base bar (upper half-blocks)
})

test("wordmark is block letters, uniform width, split inside the row", () => {
  expect(WORDMARK_ROWS).toHaveLength(5)
  expect(new Set(WORDMARK_ROWS.map(l => [...l].length)).size).toBe(1) // equal width
  expect([...WORDMARK_ROWS[0]].length).toBe(35)                      // 6 letters ×5 + 5 gaps
  expect(WORDMARK_ROWS[0].startsWith("█     █   █")).toBe(true)      // L U
  expect(WORDMARK_SPLIT).toBeGreaterThan(0)
  expect(WORDMARK_SPLIT).toBeLessThan(35)
})

test("raster rows are equal width", () => {
  expect(new Set(LOGO_ROWS.map(l => [...l].length)).size).toBe(1)
})

test("chrome height counts the transcript's bottom margin too", () => {
  // composer box 3 + context line 1 + retry line 1 + transcript bottom blank 1:
  // the window budget must reserve the blank row or the frame is 1 line taller
  // than the terminal and the logo is painted into scrollback.
  expect(CHROME_HEIGHT).toBe(6)
})

test("frameRows leaves the last row of the terminal free", () => {
  // A frame as tall as the viewport is 'fullscreen' to ink: it switches to the
  // full-clear erase path and wipes the frame on exit. One row short keeps the
  // incremental paint, so the last screen survives quitting.
  expect(frameRows(30)).toBe(29)
  expect(frameRows(24)).toBe(23)
  expect(frameRows(2)).toBe(1)
  expect(frameRows(1)).toBe(1)    // never 0: an empty root renders nothing
})

test("transcriptWindow is what the logo and the chrome leave over", () => {
  // 30 rows: 29 painted - logo 16 - chrome 6 = 7. The region below the
  // transcript never moves, so this is also the PageUp/PageDown page size.
  expect(transcriptWindow(30)).toBe(7)
  expect(transcriptWindow(24)).toBe(1)
  // The splash pad is charged to the transcript, not to the chrome.
  expect(transcriptWindow(30, logoTopPad(30))).toBe(0)
  // Short terminals degrade to an empty window, never a negative height.
  expect(transcriptWindow(20)).toBe(0)
  expect(transcriptWindow(10)).toBe(0)
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
