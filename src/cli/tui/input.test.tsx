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
