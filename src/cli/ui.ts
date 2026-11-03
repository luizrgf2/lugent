import { styleText } from "node:util"
import { LOGO_ROWS, WORDMARK_ROWS, WORDMARK_SPLIT, logoAnsi } from "./logo"

export const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const TOOL_GLYPHS: Record<string, string> = {
  read: "▸", edit: "✎", write: "+", shell: "$",
  grep: "⌕", glob: "✳", skill: "★", subagent: "↗",
}

export function glyph(tool: string): string {
  return TOOL_GLYPHS[tool] ?? "⚙"
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…"
}

/** Compact relative age for session listings: "agora", Xm, Xh, Xd, else the date. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return "agora"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  return iso.slice(0, 10)
}

export function padLine(text: string, inner: number): string {
  return `│ ${text}${" ".repeat(Math.max(0, inner - text.length))} │`
}

export function box(title: string, lines: string[]): string {
  const W = Math.max(title.length + 2, ...lines.map((l) => l.length), 0)
  const top = `┌─ ${title} ${"─".repeat(W - title.length - 1)}┐`
  const bottom = `└${"─".repeat(W + 2)}┘`
  return [top, ...lines.map((l) => padLine(l, W)), bottom].join("\n")
}

// ---- colored writers (no-op when not a TTY, so piped output stays clean) ----
const tty = process.stdout.isTTY

export function dim(s: string): string { return tty ? styleText("dim", s) : s }
export function bold(s: string): string { return tty ? styleText("bold", s) : s }
export function green(s: string): string { return tty ? styleText("green", s) : s }
export function red(s: string): string { return tty ? styleText("red", s) : s }
export function yellow(s: string): string { return tty ? styleText("yellow", s) : s }
export function cyan(s: string): string { return tty ? styleText("cyan", s) : s }

/**
 * ANSI logo of the L-mark (mirrors docs/lugent.svg): shared raster + gradient
 * from ./logo.ts (same rows and colors as the TUI's LogoMark). Plain text
 * when piped.
 */
export function logo(): string {
  const cyan = logoAnsi(LOGO_ROWS.length - 1)
  const wordPad = Math.max(0, Math.floor((16 - [...WORDMARK_ROWS[0]].length) / 2))
  const raster = LOGO_ROWS.map((l, y) =>
    tty ? `${logoAnsi(y)}${l}\x1b[0m` : l)
  const wordmark = WORDMARK_ROWS.map(l => {
    const row = " ".repeat(wordPad) + l
    return tty ? `\x1b[1m${row.slice(0, WORDMARK_SPLIT)}\x1b[0m\x1b[1m${cyan}${row.slice(WORDMARK_SPLIT)}\x1b[0m` : row
  })
  return [...raster, ...wordmark].join("\n")
}

export class Spinner {
  private i = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private cleared = false
  constructor(private label: string) {}

  start(): this {
    if (!tty) return this
    this.cleared = false
    this.timer = setInterval(() => {
      process.stdout.write(`\r${cyan(frames[this.i++ % frames.length])} ${this.label}`)
    }, 90)
    return this
  }

  stop(final: string): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (tty && !this.cleared) {
      this.cleared = true
      process.stdout.write(`\r${" ".repeat(this.label.length + 2)}\r`)
    }
    if (final) process.stdout.write(final + "\n")
  }
}
