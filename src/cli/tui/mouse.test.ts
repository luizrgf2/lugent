import { test, expect } from "bun:test"
import { PassThrough } from "node:stream"
import { splitWheel, createMouseStdin, MOUSE_ON, MOUSE_OFF } from "./mouse"

const up = "\x1b[<64;10;5M"
const down = "\x1b[<65;10;5M"

test("plain text passes through untouched", () => {
  expect(splitWheel("hello")).toEqual({ text: "hello", deltas: [], wheel: 0, held: "" })
})

test("wheel up/down reports are stripped and reported per notch", () => {
  expect(splitWheel(`a${up}b`)).toEqual({ text: "ab", deltas: [-1], wheel: -1, held: "" })
  expect(splitWheel(`a${down}b`)).toEqual({ text: "ab", deltas: [1], wheel: 1, held: "" })
})

test("several reports in one chunk stay separate even when they cancel out", () => {
  // A net sum would hide both notches here — the deltas list must not.
  expect(splitWheel(`${up}${up}${down}`)).toEqual({ text: "", deltas: [-1, -1, 1], wheel: -1, held: "" })
})

test("click reports are stripped but do not scroll", () => {
  expect(splitWheel("\x1b[<0;3;4M\x1b[<0;3;4m")).toEqual({ text: "", deltas: [], wheel: 0, held: "" })
})

test("a report split across chunks is held and completed later", () => {
  const first = splitWheel("x\x1b[<64;10")
  expect(first.text).toBe("x")
  expect(first.deltas).toEqual([])
  expect(first.held).toBe("\x1b[<64;10")
  const second = splitWheel(";5M", first.held)
  expect(second).toEqual({ text: "", deltas: [-1], wheel: -1, held: "" })
})

test("non-mouse escape sequences (arrows) are not touched", () => {
  expect(splitWheel("\x1b[A\x1b[B")).toEqual({ text: "\x1b[A\x1b[B", deltas: [], wheel: 0, held: "" })
})

test("mouse modes: 1000 button events + 1006 SGR encoding, and their off pair", () => {
  expect(MOUSE_ON).toContain("\x1b[?1000h")
  expect(MOUSE_ON).toContain("\x1b[?1006h")
  expect(MOUSE_OFF).toContain("\x1b[?1006l")
  expect(MOUSE_OFF).toContain("\x1b[?1000l")
})

test("bridge: strips mouse reports from what ink reads, reports each notch", async () => {
  const source: any = new PassThrough()
  source.isTTY = true
  source.setRawMode = () => source
  const m = createMouseStdin(source)
  const seen: string[] = []
  const wheels: number[] = []
  // ink's contract: drain with read() on every `readable`.
  m.stdin.on("readable", () => { let c: string | null; while ((c = m.stdin.read() as any) !== null) seen.push(String(c)) })
  const off = m.onWheel(d => wheels.push(d))
  const tick = () => new Promise(r => setTimeout(r, 10))

  source.write(`ab${up}cd${down}`)
  await tick()
  expect(seen.join("")).toBe("abcd")   // no escape junk reaches ink
  expect(wheels).toEqual([-1, 1])

  off()
  source.write(up)
  await tick()
  expect(wheels).toEqual([-1, 1])      // unsubscribed
  m.close()
})

test("bridge: one forwarded write is one read — a Return is never glued to text", async () => {
  const source: any = new PassThrough()
  source.isTTY = true
  source.setRawMode = () => source
  const m = createMouseStdin(source)
  const reads: string[] = []
  m.stdin.on("readable", () => { let c: string | null; while ((c = m.stdin.read() as any) !== null) reads.push(String(c)) })

  source.write("go")     // ink receives "go" alone…
  source.write("\r")     // …and the Return alone: a coalesced "go\r" parses as text
  await new Promise(r => setTimeout(r, 10))
  expect(reads).toEqual(["go", "\r"])
  m.close()
})

test("set() writes the on/off pair to the given stream and gates wheel deltas", async () => {
  const source: any = new PassThrough()
  source.isTTY = true
  source.setRawMode = () => source
  const m = createMouseStdin(source)
  const written: string[] = []
  const stream: any = { write: (s: string) => { written.push(s); return true } }
  const wheels: number[] = []
  m.onWheel(d => wheels.push(d))

  m.set(false, stream)                 // off: the terminal owns click-drag again
  expect(written).toEqual([MOUSE_OFF])
  source.write(up)
  await new Promise(r => setTimeout(r, 10))
  expect(wheels).toEqual([])           // a report that arrives anyway is not a scroll

  m.set(true, stream)                  // back on
  expect(written).toEqual([MOUSE_OFF, MOUSE_ON])
  source.write(up)
  await new Promise(r => setTimeout(r, 10))
  expect(wheels).toEqual([-1])
  m.close()
})
