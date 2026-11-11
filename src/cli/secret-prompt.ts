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
 * visible and the value is not; backspace erases one dot. Whole escape sequences
 * (arrows, Home/End, Delete, bracketed-paste markers) and every other C0 control
 * are consumed and never reach the value — this field has no line editing, and
 * appending the residue of a sequence would corrupt the secret invisibly. Ctrl+C
 * rejects with {@link ReadCancelled}. The terminal goes back
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

/**
 * Ctrl+C at a secret prompt. A distinct class (and not a message check alone) so
 * the caller can tell "the user changed their mind" from "the read failed" and
 * turn the first into a cancellation instead of a crash.
 *
 * This matters more than it looks: an uncaught rejection on ^C took the whole
 * `--plain` REPL session down with exit 1 — reproduced 3/3 on a real pty — because
 * `repl.ts` awaited the form with no handler. Ctrl+C is the documented abort key.
 */
export class ReadCancelled extends Error {
  constructor() { super("cancelled"); this.name = "ReadCancelled" }
}

/** True for a user cancellation — this module's, or a front end's own equivalent. */
export function isCancellation(e: unknown): boolean {
  return e instanceof ReadCancelled || (e instanceof Error && e.message === "cancelled")
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
    // Escape-sequence state, carried across `data` chunks. A read may deliver
    // "\u001b" and "[D" separately, and the ESC alone is indistinguishable from
    // an Alt-key prefix, so the state has to survive the boundary — otherwise the
    // tail of the sequence lands inside the secret.
    let esc: "none" | "start" | "csi" | "ss3" = "none"

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

    /**
     * True when `ch` belongs to an escape sequence and has been consumed.
     *
     * Skipping only the ESC byte was a silent-corruption bug: the rest of the
     * sequence was appended to the secret, so ← while correcting a key stored
     * `[D` inside the credential and the field — one dot per character — looked
     * identical. The state machine below eats the whole sequence, including one
     * split across two `data` chunks.
     *
     * Bracketed paste is the useful consequence: `ESC[200~ … ESC[201~` are
     * consumed as markers and the pasted text between them types in, which is how
     * a key usually arrives.
     */
    const consumeEscape = (ch: string): boolean => {
      const code = ch.codePointAt(0) ?? 0
      if (esc === "none") {
        if (ch !== "\u001b") return false
        esc = "start"
        return true
      }
      if (esc === "start") {
        if (ch === "\u001b") { esc = "start"; return true }         // ESC ESC
        if (ch === "[") { esc = "csi"; return true }
        if (ch === "O") { esc = "ss3"; return true }
        // A lone ESC followed by a real key (Alt+X) is consumed as a unit — but
        // never at the cost of Enter or Ctrl+C, which must keep working if the
        // ESC byte was a stray keystroke rather than a prefix.
        esc = "none"
        return !(ch === "\r" || ch === "\n" || ch === "\u0003")
      }
      if (esc === "csi") {
        // Final byte per ECMA-48: 0x40–0x7E ends the sequence; parameter and
        // intermediate bytes (0x20–0x3F) continue it.
        if (code >= 0x40 && code <= 0x7e) esc = "none"
        return true
      }
      esc = "none"                                                  // ss3: one char
      return true
    }

    const onData = (chunk: Buffer | string) => {
      const s = typeof chunk === "string" ? chunk : chunk.toString("utf8")
      for (const ch of s) {
        if (consumeEscape(ch)) continue
        if (ch === "\r" || ch === "\n") { finish(); return }
        if (ch === "\u0003") { cleanup(); promptOut.write("\n"); reject(new ReadCancelled()); return }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) { value = value.slice(0, -1); promptOut.write("\b \b") }
          continue
        }
        // Every remaining C0 control (^A, ^D, ^U, ^W, …) has no meaning in a
        // single-line masked field, so it must do nothing. Appending it put an
        // invisible byte in the credential.
        if ((ch.codePointAt(0) ?? 0) < 0x20) continue
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
