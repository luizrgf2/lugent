/**
 * Read a secret from a TTY without echoing it.
 *
 * `readline`'s `question()` echoes as you type, so `/add-provider`'s key prompt in
 * the `--plain` REPL left the key in terminal scrollback — for a `{env:VAR}` user
 * that is a value they deliberately never read, and for any user it is a secret in
 * a log. The TUI masks it; this is the plain-REPL equivalent, kept tiny and
 * dependency-free (no `readline`, no `ink` — `src/cli` stays ANSI-only).
 *
 * Everything typed is echoed as a single `•` per character, so the length is
 * visible and the value is not; backspace erases one dot. The terminal goes back
 * to canonical mode on the way out — a caller driving its own line reader
 * (`readline`, which `pause()`s here) re-enables its own raw mode when it resumes.
 * That is deliberate: `readline`'s `isRaw` stays `true` across a `pause()` while
 * the terminal underneath is already canonical, so trusting that flag and *not*
 * calling `setRawMode(true)` leaves the tty echoing every keystroke.
 *
 * A caller must also silence its own line reader: Bun's `readline` keeps rendering
 * the line buffer while paused (middle-truncated, which is how you recognise it),
 * so a paused `readline` still leaks the value. Use {@link muteableOutput}.
 */
/**
 * A pass-through for a stream's `write` that can be muted, so a line reader
 * suspended for a secret prompt cannot render what is being read.
 *
 * Why a wrapper and not `pause()` alone: Bun's `readline` keeps redrawing its
 * line buffer on input even while paused, so a paused reader still prints the
 * key — middle-truncated (`sk-TYP…RKER`), which is how you recognise it in a
 * capture. Muting the destination during the read is what actually keeps the
 * value out of the terminal, and it is restored in a `finally` so a rejected
 * prompt cannot leave the REPL silent.
 */
export function muteableOutput<T extends { write(s: string): unknown }>(target: T): {
  stream: { write(s: string): unknown }
  mute(): () => void
} {
  const state = { muted: false }
  const stream = {
    write(s: string) {
      if (state.muted) return true
      return target.write(s)
    },
  }
  return {
    stream,
    mute() {
      state.muted = true
      let restored = false
      return () => { if (!restored) { restored = true; state.muted = false } }
    },
  }
}

export function readSecret(opts: {
  prompt: string
  input: NodeJS.ReadStream | any
  output: NodeJS.WriteStream | { write(s: string): unknown }
  /**
   * Where the prompt goes when `output` is muted. The prompt must be visible even
   * though everything after it is silenced — that is the whole point of a prompt.
   */
  promptOutput?: { write(s: string): unknown }
}): Promise<string> {
  const { prompt, input, output } = opts
  const promptOut = opts.promptOutput ?? output
  const MASK = "•"
  return new Promise((resolve, reject) => {
    let value = ""
    let done = false

    const cleanup = () => {
      if (done) return
      done = true
      input.removeListener("data", onData)
      input.removeListener("error", onError)
      input.setRawMode?.(false)
      input.pause?.()
    }
    const finish = () => {
      cleanup()
      promptOut.write("\n")
      resolve(value)
    }
    const onError = (e: unknown) => { cleanup(); reject(e) }

    const onData = (chunk: Buffer | string) => {
      const s = typeof chunk === "string" ? chunk : chunk.toString("utf8")
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") { finish(); return }
        if (ch === "\u0003") { cleanup(); promptOut.write("\n"); reject(new Error("cancelled")); return }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) { value = value.slice(0, -1); promptOut.write("\b \b") }
          continue
        }
        if (ch === "\u001b") continue   // ignore escape sequences (arrow keys)
        value += ch
        promptOut.write(MASK)
      }
    }

    // Raw mode goes on unconditionally, and BEFORE the prompt is printed. Two
    // reasons: the other order leaves a window in which the tty is still
    // canonical, so a paste arriving there is echoed by the kernel and lands in
    // scrollback; and `input.isRaw` cannot be trusted here — `readline` leaves it
    // `true` across a `pause()` while the tty is already canonical underneath.
    input.setRawMode?.(true)
    input.resume?.()
    promptOut.write(prompt)
    input.on("data", onData)
    input.on("error", onError)
  })
}
