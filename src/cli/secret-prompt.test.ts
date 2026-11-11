import { test, expect } from "bun:test"
import { EventEmitter } from "node:events"
import { readSecret, muteableOutput } from "./secret-prompt"

/**
 * A fake TTY: `setRawMode`/`resume` are recorded so a test can prove the mode is
 * restored, and `emit` feeds keystrokes the way the terminal would.
 */
function fakeTty() {
  const input: any = new EventEmitter()
  input.isRaw = false
  const rawCalls: boolean[] = []
  input.setRawMode = (v: boolean) => { input.isRaw = v; rawCalls.push(v); return input }
  input.resume = () => input
  let out = ""
  const output = { write: (s: string) => { out += s; return true } }
  return { input, output, rawCalls, typed: () => out, reset: () => { out = "" } }
}

test("readSecret resolves on enter and never writes what was typed", async () => {
  const t = fakeTty()
  const p = readSecret({ prompt: "api key: ", input: t.input, output: t.output })
  t.input.emit("data", Buffer.from("sk-supersecret"))
  t.input.emit("data", Buffer.from("\r"))
  await expect(p).resolves.toBe("sk-supersecret")
  // The whole point: the value is not in the terminal's output at all, so it
  // cannot sit in scrollback.
  expect(t.typed()).not.toContain("supersecret")
  expect(t.typed()).toContain("api key: ")
  expect(t.typed()).toContain("•".repeat("sk-supersecret".length))
})

test("readSecret masks every character, backspace included", async () => {
  const t = fakeTty()
  const p = readSecret({ prompt: "api key: ", input: t.input, output: t.output })
  t.input.emit("data", Buffer.from("abc"))
  t.input.emit("data", Buffer.from("\u007f"))       // ⌫ removes one dot
  t.input.emit("data", Buffer.from("d\r"))
  await expect(p).resolves.toBe("abd")
  expect(t.typed()).not.toContain("abc")
  // 3 typed, one erased, one typed → the visible dots match the final length.
  expect(t.typed().split("\b \b").length - 1).toBe(1)
})

test("readSecret puts the terminal back where it found it", async () => {
  const t = fakeTty()
  const p = readSecret({ prompt: "key: ", input: t.input, output: t.output })
  t.input.emit("data", Buffer.from("k\r"))
  await p
  // raw on at the start, raw off at the end — a REPL that came back with the
  // terminal still raw would stop echoing the next prompt entirely.
  expect(t.rawCalls).toEqual([true, false])
  expect(t.input.isRaw).toBe(false)
})

test("readSecret handles a multi-byte chunk with the newline inside it", async () => {
  // A paste or a fast typist delivers the whole line in one chunk.
  const t = fakeTty()
  const p = readSecret({ prompt: "key: ", input: t.input, output: t.output })
  t.input.emit("data", Buffer.from("sk-abc\r"))
  await expect(p).resolves.toBe("sk-abc")
})

test("readSecret writes the prompt and the mask to promptOutput when the main output is muted", async () => {
  // Verified on a real pty: Bun's readline keeps redrawing its line buffer even
  // while paused, so the REPL mutes readline's output for the read. The prompt and
  // the dots must still be visible — that is the only thing telling the user to type.
  const t = fakeTty()
  let muted = ""
  const muted_ = { write: (s: string) => { muted += s; return true } }
  const p = readSecret({ prompt: "api key: ", input: t.input, output: muted_, promptOutput: t.output })
  t.input.emit("data", Buffer.from("ab\r"))
  await expect(p).resolves.toBe("ab")
  expect(muted).toBe("")                       // nothing at all reached readline's stream
  expect(t.typed()).toContain("api key: ")
  expect(t.typed()).toContain("••")
})

test("muteableOutput drops writes while muted and restores exactly once", () => {
  let out = ""
  const target = { write: (s: string) => { out += s; return true } }
  const m = muteableOutput(target)
  m.stream.write("before ")
  const unmute = m.mute()
  m.stream.write("SECRET")
  expect(out).toBe("before ")
  unmute()
  m.stream.write("after")
  unmute()                                     // idempotent — a second finally must not double-apply
  m.stream.write("!")
  expect(out).toBe("before after!")
})
test("readSecret always sets raw mode, even when stdin claims it is already raw", async () => {
  // `readline` leaves `isRaw === true` across a `pause()` while the tty beneath is
  // already canonical. Trusting that flag and skipping `setRawMode(true)` leaves
  // the kernel echoing every keystroke — verified on a real pty: the key appeared
  // verbatim in the stream. So raw mode is set unconditionally.
  const t = fakeTty()
  t.input.isRaw = true
  const p = readSecret({ prompt: "key: ", input: t.input, output: t.output })
  t.input.emit("data", Buffer.from("k\r"))
  await p
  expect(t.rawCalls).toEqual([true, false])
})

// --- Escape sequences and control keys ---------------------------------------
//
// The first version skipped only the ESC byte and appended the rest of the
// sequence, so pressing ← while correcting a key stored `[D` *inside* the
// secret — invisibly, because the field renders one dot per character. Every
// multi-byte sequence and every unhandled control byte had the same effect
// (reproduced on a real pty: typed "sk-ab", ←, "cd" → saved `sk-ab[Dcd`).
// The field needs no cursor movement to be correct; it needs to not corrupt
// the secret.

/** Feed keystrokes, in the exact chunks a terminal delivers them. */
async function typedValue(chunks: string[]): Promise<string> {
  const t = fakeTty()
  const p = readSecret({ prompt: "key: ", input: t.input, output: t.output })
  for (const c of chunks) t.input.emit("data", Buffer.from(c))
  return await p
}

test("readSecret ignores an arrow key instead of typing its bytes", async () => {
  expect(await typedValue(["sk-ab", "\u001b[D", "cd\r"])).toBe("sk-abcd")
})

test("readSecret consumes every escape-sequence class, leaving no residue", async () => {
  const sequences: [string, string][] = [
    ["left", "\u001b[D"], ["right", "\u001b[C"], ["up", "\u001b[A"], ["down", "\u001b[B"],
    ["home", "\u001b[H"], ["end-F", "\u001b[F"], ["delete", "\u001b[3~"],
    ["home-1", "\u001b[1~"], ["insert", "\u001b[2~"], ["pageup", "\u001b[5~"],
    ["pagedown", "\u001b[6~"], ["ss3-left", "\u001bOD"], ["alt-x", "\u001bx"],
  ]
  for (const [label, seq] of sequences) {
    expect([label, await typedValue(["a", seq, "b\r"])]).toEqual([label, "ab"])
  }
})

test("readSecret consumes an escape sequence split across two chunks", async () => {
  // A read can hand over "\u001b" and "[D" in separate chunks, and the ESC alone
  // looks exactly like an Alt-key prefix. The sequence state has to survive the
  // chunk boundary or the tail lands in the secret anyway.
  expect(await typedValue(["a", "\u001b", "[D", "b\r"])).toBe("ab")
  expect(await typedValue(["a", "\u001b[", "D", "b\r"])).toBe("ab")
})

test("readSecret ignores control keys other than backspace and Ctrl+C", async () => {
  // ^D/^A/^U/^W at a real prompt are EOF / line-start / kill-line / kill-word;
  // this reader has no line editing, so the only correct thing they can do is
  // nothing. They used to be appended verbatim.
  for (const [label, ctl] of [["^D", "\u0004"], ["^A", "\u0001"], ["^U", "\u0015"], ["^W", "\u0017"]] as [string, string][]) {
    expect([label, await typedValue(["ab", ctl, "cd\r"])]).toEqual([label, "abcd"])
  }
})

test("readSecret rejects a Ctrl+C with a cancellable error and restores the tty", async () => {
  // The rejection is the contract the REPL catches: Ctrl+C is the documented way
  // to abort, and an uncaught rejection ends the whole process.
  const t = fakeTty()
  const p = readSecret({ prompt: "key: ", input: t.input, output: t.output })
  t.input.emit("data", Buffer.from("\u0003"))
  await expect(p).rejects.toThrow("cancelled")
  expect(t.rawCalls).toEqual([true, false])
  expect(t.typed()).not.toContain("sk-")
})
