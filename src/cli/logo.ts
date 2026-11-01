/**
 * Shared L-mark logo: half-block raster of docs/lugent.svg's mark (chevron
 * stroke, base bar, agent dot) + the SVG's gradient (#00F5A0 → #00D9F5,
 * diagonal). Pure module: both the plain REPL (ANSI codes) and the TUI
 * (hex colors for ink) consume the same rows and the same color math.
 */
export const LOGO_ROWS = [
  "██▄             ",
  " ▀██▄           ",
  "   ▀██▄         ",
  "     ▀██▄       ",
  "      ▄███▀ ●   ",
  "   ▄███▀        ",
  " ▄███▀          ",
  "███▀            ",
  "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
  "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
]

const GRAD_START: [number, number, number] = [0x00, 0xf5, 0xa0]
const GRAD_END: [number, number, number] = [0x00, 0xd9, 0xf5]

const rgb = (i: number): [number, number, number] => {
  const t = i / (LOGO_ROWS.length - 1)
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return [mix(GRAD_START[0], GRAD_END[0]), mix(GRAD_START[1], GRAD_END[1]), mix(GRAD_START[2], GRAD_END[2])]
}

/** Row color as a hex string (ink `color` prop). */
export function logoHex(i: number): string {
  const [r, g, b] = rgb(i)
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`
}

/** Row color as an ANSI truecolor SGR sequence (plain REPL). */
export function logoAnsi(i: number): string {
  const [r, g, b] = rgb(i)
  return `\x1b[38;2;${r};${g};${b}m`
}
