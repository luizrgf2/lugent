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
