import { test, expect } from "bun:test"
import { renderTui } from "./harness"
import { Input } from "./input"

test("enter submits, empty submit is a no-op", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={(t) => got.push(t)} />)
  type("hi\r")
  await new Promise(r => setTimeout(r, 30))
  type("\r")      // empty
  type("  \r")    // whitespace
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["hi"])
  expect(lastFrame()).not.toContain("hi")   // cleared after submit
})

test("up arrow recalls last submitted input", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={(t) => got.push(t)} />)
  type("one\r")
  await new Promise(r => setTimeout(r, 30))
  type("\u001b[A")   // ↑
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("one")
})

test("disabled input ignores keys", async () => {
  const got: string[] = []
  const { type } = renderTui(<Input disabled={true} onSubmit={(t) => got.push(t)} />)
  type("x\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual([])
})

test("ctrl keys are not typed as characters", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={(t) => got.push(t)} />)
  type("ab\x03")   // a, b, ctrl+c
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual([])
  expect(lastFrame()).not.toContain("c")   // ctrl+c never becomes a character
})

const CMDS = [
  { cmd: "exit", desc: "quit lugent" },
  { cmd: "model", desc: "switch provider/model" },
  { cmd: "skills", desc: "browse skills" },
]

test("/ lists commands, prefix filters as you type", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} completions={CMDS} />)
  type("/")
  await new Promise(r => setTimeout(r, 30))
  const all = lastFrame()
  expect(all).toContain("/exit"); expect(all).toContain("/model"); expect(all).toContain("/skills")
  expect(all).toContain("quit lugent"); expect(all).toContain("browse skills")
  type("mo")
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("/model"); expect(f).toContain("switch provider/model")
  expect(f).not.toContain("/exit"); expect(f).not.toContain("/skills")
})

test("tab completes the selected command and submits", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} completions={CMDS} />)
  type("/mo\t\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["/model"])
})

test("arrows navigate suggestions, not history, while open", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} completions={CMDS} />)
  type("older\r")
  await new Promise(r => setTimeout(r, 30))
  type("/e\u001b[A\t\r")   // ↑ with suggestions open: must NOT recall "older"
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["older", "/exit"])
})

test("enter picks the highlighted suggestion, not the raw prefix", async () => {
  const got: string[] = []
  const { type } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} completions={CMDS} />)
  type("/\u001b[B\r")   // open list, ↓ to /model, enter
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["/model"])
})

test("enter submits while suggestions open, box clears", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} completions={CMDS} />)
  type("/model\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["/model"])
  expect(lastFrame()).not.toContain("switch provider/model")   // suggestions gone
})

test("no prefix match hides suggestions", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} completions={CMDS} />)
  type("/x")
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("/x")
  expect(f).not.toContain("/exit"); expect(f).not.toContain("/model"); expect(f).not.toContain("/skills")
})

// --- Caret (cursor) state ---
// The caret ▏ marks where insertion would happen. With the tail-only ornament it
// always sat after the last character; these pin the real caret position.
const LEFT = "\u001b[D"
const RIGHT = "\u001b[C"
const HOME = "\x1b[H"
const END = "\x1b[F"

test("mid-text cursor: arrows move the caret inside the text", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type("hello")
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("hello▏")   // caret starts at the end
  type(LEFT + LEFT)                          // caret between the l's
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("hel▏lo")
  expect(f).not.toContain("hello▏")
})

test("right arrow clamps at the end of the value", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type("hello")
  type(LEFT + LEFT)              // mid-text
  type(RIGHT + RIGHT + RIGHT)    // one extra press: clamps at the end
  type(LEFT)                     // ...so one left lands before the final 'o'
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("hell▏o")
})

test("left arrow clamps at the start; typing inserts there", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type("hello")
  type(LEFT.repeat(10))
  type("X")
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("X▏hello")
})

test("home jumps to the start, end back to the end", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type("hello")
  type(HOME)
  type("X")
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("X▏hello")
  type(END)
  type("!")
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("hello!▏")
})

test("backspace at the caret deletes the character before it", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type("hello")
  type(LEFT + LEFT)          // caret before the final 'l'
  type("\u001b[3~")          // Delete key: deletes before the caret (lumped with Backspace)
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("he▏lo")
})

test("multi-line value: the caret renders on its line", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  // ink parses a bare \n as 'enter' (not key.return), so a typed \n inserts a
  // newline without submitting — the same value shape a paste produces.
  // (Ink pads box lines to full width, so assertions match per-line fragments.)
  type("ab\ncd")
  await new Promise(r => setTimeout(r, 30))
  type(LEFT + LEFT + LEFT)   // caret at index 2: end of the first line, before \n
  await new Promise(r => setTimeout(r, 30))
  let f = lastFrame()
  expect(f).toContain("ab▏")        // caret at line 1's end...
  expect(f).not.toContain("cd▏")    // ...not at the value's tail
  type(RIGHT)                // caret at index 3: start of line 2
  await new Promise(r => setTimeout(r, 30))
  f = lastFrame()
  expect(f).toContain("▏cd")        // caret at line 2's start...
  expect(f).not.toContain("ab▏")    // ...and no longer at line 1's end
})

test("history recall puts the caret at the end of the recalled text", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} />)
  type("one\r")
  await new Promise(r => setTimeout(r, 30))
  type("\u001b[A")           // recall "one" — caret must land at the end
  type(LEFT)                 // caret between 'n' and 'e'
  type("!")                  // inserts there, caret moves past it
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("on!▏e")
  expect(f).not.toContain("!▏one")   // rules out a recall that reset the caret to 0
})

test("disabled input renders no caret at all", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={true} onSubmit={() => {}} />)
  type("hi")
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).not.toContain("▏")
})

test("caret navigation leaves suggestions and history alone", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} completions={CMDS} />)
  type("older\r")
  await new Promise(r => setTimeout(r, 30))
  type("/mo")                       // suggestions open on /mo
  await new Promise(r => setTimeout(r, 30))
  type(LEFT + RIGHT)                // navigate inside "/mo"
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("switch provider/model")   // suggestions stayed open
  type("\r")                        // enter still picks the highlighted suggestion
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["older", "/model"])
})
// ---- bracketed paste -----------------------------------------------------
// Terminals wrap pasted text in ESC[200~ … ESC[201~ (bracketed paste mode);
// ink's usePaste hands the inner text to the component as one string. The
// harness type() feeds the raw bytes, so tests reproduce exactly what a real
// terminal delivers on a multi-line paste — including the \n characters that
// previously made ink run key.return once per line.

const PASTE = (body: string) => "\u001b[200~" + body + "\u001b[201~"

test("pasting a single line types it as text", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} />)
  type(PASTE("just one line"))
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("just one line")
  type("\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["just one line"])
})

test("small single-line paste below the length threshold types as text", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type(PASTE("short"))
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("short")
  expect(lastFrame()).not.toContain("[paste #1")
})

test("multi-line paste collapses to a token, not newline storms", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} />)
  type(PASTE("line one\nline two\nline three"))
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("[paste #1: 3 lines]")
  expect(f).not.toContain("line two")   // full text never renders in the composer
  expect(f.split("\n").every(l => !l.startsWith("> ") || l.includes("[paste #1") || l.includes("line one")))
  type("\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["line one\nline two\nline three"])   // model gets the full text
  expect(lastFrame()).not.toContain("[paste #1")            // box clears after submit
})

test("long single-line paste collapses to a token too", async () => {
  const got: string[] = []
  const long = "x".repeat(300)
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} />)
  type(PASTE(long))
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("[paste #1: 300 chars]")
  type("\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual([long])
})

test("successive pastes number their tokens incrementally", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type(PASTE("a\nb"))
  type(PASTE("c\nd"))
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("[paste #1: 2 lines]")
  expect(f).toContain("[paste #2: 2 lines]")
})

test("typing around tokens keeps them in place", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} />)
  type(PASTE("p1\np2"))
  type("hello ")
  type(PASTE("q1\nq2"))
  type(" world")
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  // Tokens are opaque atoms in the composer, in paste order.
  expect(f).toContain("[paste #1: 2 lines]hello [paste #2: 2 lines] world")
  expect(f).not.toContain("p1")
  expect(f).not.toContain("q2")
  type("\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["p1\np2hello q1\nq2 world"])
})

test("backspace after a paste deletes the whole token, not one char", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type(PASTE("a\nb"))
  type("\u007f")   // backspace
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).not.toContain("[paste #1")
  expect(f).not.toContain("\u0000placeholder\u0000")
})

test("backspace on plain text still deletes one character", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type("/sk")
  await new Promise(r => setTimeout(r, 30))
  type("\b\bm")    // back to "/", then retype m
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("> /m")
})

test("submitting around tokens: empty trim with only token is still submitted", async () => {
  const got: string[] = []
  const { type } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} />)
  type(PASTE("a\nb"))
  type("\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["a\nb"])
})

test("typed text around tokens is part of the submitted text", async () => {
  const got: string[] = []
  const { type } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} />)
  type(PASTE("x\ny"))
  type(" and ")   // typed after the token, before enter
  type("\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["x\ny and"])   // submitted text is token expansion + typed text
})

test("history recalls token text, not the expansion", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type(PASTE("h1\nh2"))
  type("\r")
  await new Promise(r => setTimeout(r, 30))
  type("plain\r")
  await new Promise(r => setTimeout(r, 30))
  type("\u001b[A")   // ↑ → "plain"
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("plain")
  type("\u001b[A")   // ↑ → paste token
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("[paste #1: 2 lines]")
  expect(f).not.toContain("h1\nh2")
  expect(f).not.toContain("h1 h2")   // must not be the expanded form
})

test("small typed newlines (shift+enter style ctrl+j) still submit per return key", async () => {
  const got: string[] = []
  const { type } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} />)
  type("a\rb\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["a", "b"])
})

test("paste while suggestions open does not submit the slash prefix", async () => {
  const got: string[] = []
  const { type } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} completions={CMDS} />)
  type("/")       // suggestions open
  type(PASTE("m\nx"))   // would contain "m" → tab-pick hazards
  await new Promise(r => setTimeout(r, 30))
  type("\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["/m\nx"])
})

// ---- token atomicity -------------------------------------------------------
// The caret must never sit inside a token: ←/→ and Home/End snap to the
// nearest token boundary, so typing or backspacing can never corrupt the
// NUL-delimited label (a corrupted label no longer matches PASTE_TOKEN_RE and
// would be submitted to the model literally, NUL bytes included).

test("caret snaps over a token when walking left across it", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type("ab")
  type(PASTE("x\ny"))
  type("cd")
  await new Promise(r => setTimeout(r, 30))
  // Walk left 1 → before "cd"; one more step must jump the whole token,
  // landing before it, not inside its label.
  type("\u001b[D\u001b[D\u001b[D")
  await new Promise(r => setTimeout(r, 30))
  type("\u007f")   // backspace: deletes the "b" before the token, not label bytes
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("[paste #1: 2 lines]")   // token label intact
  type("\r")
  await new Promise(r => setTimeout(r, 30))
})

test("typing with the caret adjacent to a token never enters the label", async () => {
  const got: string[] = []
  const { type } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} />)
  type(PASTE("x\ny"))
  type("ab")
  // Caret to the very start, then walk right: the first step skips the whole
  // token (landing before "a"), the second lands between "a" and "b" — never
  // inside the label.
  type("\u001b[H")   // home
  type("\u001b[C\u001b[C")   // right, right → after the token, between a|b
  type("Z")
  await new Promise(r => setTimeout(r, 30))
  type("\r")
  await new Promise(r => setTimeout(r, 30))
  expect(got).toEqual(["x\nyaZb"])
})

test("home with a leading token leaves the caret before it, label intact", async () => {
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={() => {}} />)
  type(PASTE("x\ny"))
  type("tail")
  type("\u001b[H")   // home: caret starts before the token already
  type("\u001b[C")   // right: snaps past the whole token, not into it
  type("\u007f")     // backspace at the token's left edge deletes the token whole
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).not.toContain("[paste #1")
  expect(f).not.toContain("\u0000")
  type("\r")
  await new Promise(r => setTimeout(r, 30))
})

test("corrupted-label regression: mid-token caret position is unreachable", async () => {
  const got: string[] = []
  const { type, lastFrame } = renderTui(<Input disabled={false} onSubmit={t => got.push(t)} />)
  type("ab")
  type(PASTE("x\ny"))
  type("\u001b[D\u001b[D\u001b[D\u001b[D\u001b[D")   // walk left through/past the token
  type("M")   // typed at a snapped boundary
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("[paste #1: 2 lines]")   // label never mangled
  expect(f).not.toContain("\u0000[l")          // no partial-label corruption
  type("\r")
  await new Promise(r => setTimeout(r, 30))
  // Submitted text expands cleanly: no stray NUL bytes reach the model.
  expect(got).toHaveLength(1)
  expect(got[0]).not.toContain("\u0000")
  expect(got[0]).toContain("x\ny")
})
