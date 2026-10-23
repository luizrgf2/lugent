import { styleText } from "node:util"

export const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const TOOL_GLYPHS: Record<string, string> = {
  read: "▸", edit: "✎", write: "+", shell: "$",
  grep: "⌕", glob: "✳", skill: "★",
}

export function glyph(tool: string): string {
  return TOOL_GLYPHS[tool] ?? "⚙"
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…"
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
