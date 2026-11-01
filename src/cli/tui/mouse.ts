/**
 * Terminal mouse support. Ink has no mouse handling: a wheel report arrives on
 * stdin as raw bytes, the input parser strips the ESC and the transcript never
 * moves — the wheel looks dead.
 *
 * Scope: wheel only, using SGR encoding (1006) + button events (1000). We switch
 * the modes on around the TUI session and turn them off on the way out (leaving
 * them on would break text selection in the user's shell afterwards). Reports
 * are stripped from what ink reads and surfaced as scroll deltas on a side
 * channel; clicks/motion are dropped, since the TUI has no hit-testing.
 */
import { EventEmitter } from "node:events"

/** Button-event tracking (1000) + SGR encoding (1006): wheel and clicks with coordinates. */
export const MOUSE_ON = "\x1b[?1000h\x1b[?1006h"
export const MOUSE_OFF = "\x1b[?1006l\x1b[?1000l"

// ESC [ < b ; x ; y (M|m) — SGR mouse report. `b` bit 6 = wheel (64 up / 65 down).
const REPORT = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g
// A report can straddle two stdin chunks: keep the unterminated tail for later.
const PARTIAL = /\x1b\[<\d*(;\d*){0,2}$/

export type Split = { text: string; deltas: number[]; wheel: number; held: string }

/**
 * Separate SGR mouse reports from real input. `deltas` holds one entry per
 * wheel report (−1 = up, +1 = down) so callers can react per notch; `wheel` is
 * their net sum (−1 for a single up, 0 when up and down cancel out).
 * `held` is a partial report left over at the end of the chunk; pass it back
 * as `carry` on the next call.
 */
export function splitWheel(chunk: string, carry = ""): Split {
  const buf = carry + chunk
  const deltas: number[] = []
  const text = buf.replace(REPORT, (_m, b: string) => {
    const code = Number(b)
    if (code & 64) deltas.push(code & 1 ? 1 : -1)
    return ""
  })
  const wheel = deltas.reduce((a, b) => a + b, 0)
  const rest = PARTIAL.exec(text)
  if (!rest) return { text, deltas, wheel, held: "" }
  return { text: text.slice(0, rest.index), deltas, wheel, held: text.slice(rest.index) }
}

export type MouseStdin = {
  /** Stream to hand to ink's `render({ stdin })`. */
  stdin: NodeJS.ReadStream
  /** Subscribe to wheel deltas (negative = up). Returns an unsubscribe. */
  onWheel(fn: (delta: number) => void): () => void
  /** Stop proxying: detaches the source and drops queued input. */
  close(): void
}

/**
 * Build the stream ink reads from: a queue with a `read()`, exactly what ink
 * drains (`while (stdin.read() !== null)`) and expects `readable` on. Kept
 * separate from the source so each forwarded write is one read — batching two
 * keys into one chunk makes ink's parser treat `\r` as text ("go\r").
 */
function queuedStdin(source: NodeJS.ReadStream) {
  const emitter = new EventEmitter()
  const queue: string[] = []
  const stdin: any = emitter
  stdin.isTTY = (source as any).isTTY
  stdin.isRaw = true
  stdin.setRawMode = (on: boolean) => { (source as any).setRawMode?.(on); return stdin }
  stdin.setEncoding = () => stdin
  stdin.ref = () => { source.ref?.(); return stdin }
  stdin.unref = () => { source.unref?.(); return stdin }
  stdin.pause = () => stdin
  stdin.resume = () => stdin
  stdin.read = () => queue.shift() ?? null
  /** Emit one writable tick per chunk: a single `read()` may return only the first, but ink drains in a loop — the queue keeps them separate. */
  const push = (chunk: string) => {
    queue.push(chunk)
    emitter.emit("readable")
  }
  return { stdin: stdin as NodeJS.ReadStream, push, clear: () => { queue.length = 0 } }
}

/** Wrap stdin so mouse reports never reach ink; wheel deltas come out `onWheel`. */
export function createMouseStdin(source: NodeJS.ReadStream): MouseStdin {
  const q = queuedStdin(source)
  const emit = new Set<(d: number) => void>()
  let carry = ""
  const onData = (chunk: Buffer | string) => {
    const { text, deltas, held } = splitWheel(String(chunk), carry)
    carry = held
    if (text) q.push(text)
    for (const d of deltas) for (const fn of emit) fn(d)
  }
  source.on("data", onData)
  ;(source as any).resume?.()

  return {
    stdin: q.stdin,
    onWheel(fn) {
      emit.add(fn)
      return () => { emit.delete(fn) }
    },
    close() {
      source.off("data", onData)
      carry = ""
      emit.clear()
      q.clear()
    },
  }
}
