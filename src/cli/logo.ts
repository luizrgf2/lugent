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

// Block-letter wordmark (5×5 glyphs, one space between letters) — "LUGENT"
// rendered large instead of one text line. Rows are uniform width so the
// plain REPL can pad the raster to match.
const GLYPHS: Record<string, string[]> = {
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  U: ["█   █", "█   █", "█   █", "█   █", "█████"],
  G: [" ████", "█    ", "█  ██", "█   █", " ████"],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
}

const WORD = ["L", "U", "G", "E", "N", "T"]
export const WORDMARK_ROWS = Array.from({ length: 5 }, (_, y) =>
  WORD.map(ch => GLYPHS[ch][y]).join(" "))

// Char index where "LUG" ends and the cyan "ENT" tail begins (two-tone split):
// L,U,G are 5 wide + 1 gap each → LUG spans [0,18).
export const WORDMARK_SPLIT = 3 * 6

// Rendered height of <LogoMark/> in the TUI: raster rows + wordmark block
// rows + 1 bottom margin. The transcript window must subtract this exact
// number or every frame is taller than the terminal and scrolls history off-screen.
export const LOGO_HEIGHT = LOGO_ROWS.length + WORDMARK_ROWS.length + 1

// Rows the TUI keeps below the transcript: composer box 3 + context line 1
// + retry line 1 + one blank separating the transcript from the chrome.
// Shared so the window budget and the splash centering can never disagree
// about how much room the chrome takes.
export const CHROME_HEIGHT = 6

/**
 * Rows the TUI paints on a terminal of `rows`. One row is left free at the
 * bottom: a frame that reaches the viewport height is treated by ink as
 * fullscreen, which changes the erase strategy between frames and wipes the
 * frame on exit. Staying one short keeps the incremental path (and leaves the
 * last frame on screen when you quit), while still filling the terminal.
 */
export function frameRows(rows: number): number {
  return Math.max(1, rows - 1)
}

/**
 * Rows the transcript region gets on a terminal of `rows`: what is left after
 * the logo block and the chrome. The region is rendered at this height
 * (bottom-aligned, clipped) so the composer below it cannot move — sized from
 * its content instead, a page of scroll or a wrapped long line changed the frame
 * height and shifted the input on screen.
 */
export function transcriptWindow(rows: number, pad = 0): number {
  return Math.max(0, frameRows(rows) - CHROME_HEIGHT - LOGO_HEIGHT - pad)
}

/**
 * Blank rows above <LogoMark/> while the transcript is still empty, so the
 * logo opens in the vertical middle of the screen instead of hugging the top.
 * Half the viewport slack, capped by the rows the chrome (and the logo itself)
 * still need — a short terminal degrades to "no padding" rather than an
 * overflowing frame that scrolls history off.
 */
export function logoTopPad(rows: number): number {
  const centered = Math.floor((rows - LOGO_HEIGHT) / 2)
  const fits = rows - LOGO_HEIGHT - CHROME_HEIGHT
  return Math.max(0, Math.min(centered, fits))
}

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
