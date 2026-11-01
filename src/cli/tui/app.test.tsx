import { test, expect } from "bun:test"
import { rmSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { App, runTui } from "./app"
import { renderTui } from "./harness"
import { MOUSE_ON, MOUSE_OFF } from "./mouse"
import { Store } from "../../core/store"

const WHEEL_UP = "\x1b[<64;5;5M"
const WHEEL_DOWN = "\x1b[<65;5;5M"

/** stdout double: collects frames, reports TTY + rows. */
export function fakeStdout(rows = 30) {
  const frames: string[] = []
  const stream: any = new EventEmitter()
  Object.assign(stream, {
    columns: 100, rows, isTTY: true,
    write(s: string, cb?: (e?: Error | null) => void) { frames.push(s); cb?.(null); return true },
  })
  const out = {
    stream, frames,
    lastFrame() {
      // The renderer also writes bare escape sequences (mouse modes, cursor
      // moves); the frame to assert on is the last one with visible text.
      for (let i = frames.length - 1; i >= 0; i--) {
        const s = stripAnsi(frames[i])
        if (s.trim()) return s
      }
      return ""
    },
  }
  return out
}

/**
 * stdin double: a real flowing stream (the mouse bridge listens on `data`) with
 * raw-mode controls. `type` writes one chunk per call — a mouse report must stay
 * whole or the parser can never match it.
 */
export function fakeStdin() {
  const stream: any = new PassThrough()
  // Raw-mode controls only: overriding pause/resume/on would kill the stream's
  // own flow (the mouse bridge attaches a `data` listener and resumes it).
  stream.isTTY = true
  stream.isRaw = true
  stream.setRawMode = () => stream
  stream.ref = () => stream
  stream.unref = () => stream
  return {
    stream,
    /** One key per write, like a raw-mode terminal (a coalesced "go\r" parses as text). */
    type(s: string) { for (const ch of s) stream.write(ch) },
    /** One chunk verbatim — for escape sequences that must stay whole. */
    write(s: string) { stream.write(s) },
  }
}

const stripAnsi = (s: string): string =>
  s.replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1B\][^\x07]*\x07/g, "")

let dbN = 0

export function fakeEnv(over: Record<string, unknown> = {}): any {
  const db = `/tmp/opencode/tui-env-${++dbN}.db`
  rmSync(db, { force: true })
  return {
    config: { defaultProvider: "9router", defaultModel: "glm/glm-5.2", providers: { "9router": { baseUrl: "http://x/v1" }, "ollama": { baseUrl: "http://y/v1" } } },
    tools: [],
    skills: [],
    agents: [],
    projectRoot: "/tmp/opencode",
    store: new Store(db),
    offProviders: [],
    mcp: { states: () => [], reconnect: async () => {}, disable: async () => {}, enable: async () => {}, authenticate: async () => {}, logout: async () => {} },
    ...over,
  }
}

const CARET = "▏"   // composer caret: rendered only while no turn is running

/** Polls until `cond` holds — keys typed during a turn are dropped, so tests must wait on state, not on sleeps. */
async function waitFor(cond: () => boolean, ms = 3000) {
  const t0 = Date.now()
  while (!cond() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 5))
  expect(cond()).toBe(true)
}

test("app skeleton renders wordmark, model and empty transcript", async () => {
  const { lastFrame } = renderTui(<App env={fakeEnv()} />)
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("█     █   █")   // block L U of the wordmark
  expect(lastFrame()).toContain("9router · glm/glm-5.2")
})

test("big L-mark logo renders above everything, outside any border", async () => {
  const { lastFrame } = renderTui(<App env={fakeEnv()} />)
  await new Promise(r => setTimeout(r, 30))
  const frame = lastFrame()
  // the raster mark: chevron top, base bar, single dot — drawn with half-blocks,
  // one color per row sampling the SVG gradient
  expect(frame).toContain("██▄")
  expect(frame).toContain("▀▀▀▀▀▀▀▀")
  expect(frame).toContain("●")
  expect(frame).not.toContain("▟▙")   // old mini-mark inside the box is gone
  // mark lines sit above the composer box (round border = ╭)
  const markRow = frame.split("\n").findIndex(l => l.includes("██▄"))
  const boxRow = frame.split("\n").findIndex(l => l.includes("╭"))
  expect(markRow).toBeGreaterThanOrEqual(0)
  expect(markRow).toBeLessThan(boxRow)
})

test("big L-mark logo is horizontally centered on the screen", async () => {
  const { lastFrame } = renderTui(<App env={fakeEnv()} />)
  await new Promise(r => setTimeout(r, 30))
  const lines = lastFrame().split("\n")
  const markIdx = lines.findIndex(l => l.includes("▀▀▀▀▀▀▀▀"))
  const base = lines[markIdx]
  const width = Math.max(...lines.map(l => [...l].length))
  const start = [...base].indexOf("▀")
  // the 16-wide bar sits around the middle (±4 cols) — not flush left
  expect(Math.abs(start - Math.floor(width / 2 - 8))).toBeLessThanOrEqual(4)
})

test("big L-mark logo opens vertically centered on the splash screen", async () => {
  const { lastFrame } = renderTui(<App env={fakeEnv()} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  const lines = lastFrame().split("\n")
  const markIdx = lines.findIndex(l => l.includes("██▄"))
  const wmIdx = lines.findLastIndex(l => l.includes("█████"))  // wordmark bottom row
  // blank rows above and below: the logo block's middle sits around the middle
  // of the 30-row viewport (pad = (30 - LOGO_HEIGHT) / 2 = 7)
  expect(markIdx).toBe(7)
  expect(lines.slice(0, markIdx).every(l => l.trim() === "")).toBe(true)
  const centre = (markIdx + wmIdx) / 2
  expect(Math.abs(centre - (30 - 1) / 2)).toBeLessThanOrEqual(2)
})

test("splash padding collapses once the transcript has content", async () => {
  const provider = { chat: async (a: any) => { a.onToken?.("hello"); return { content: "hello", toolCalls: [] } } }
  const env = fakeEnv({ tools: [], makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame().split("\n").findIndex(l => l.includes("██▄"))).toBe(7)
  type("go\r")
  await waitFor(() => lastFrame().includes("hello"))
  const lines = lastFrame().split("\n")
  // pad gives the rows back to the transcript: the mark is back at the top and
  // the frame never grows past the terminal
  expect(lines.findIndex(l => l.includes("██▄"))).toBe(0)
  expect(lines.length).toBeLessThanOrEqual(30)
  expect(lines.findIndex(l => l.includes("╭"))).toBeLessThan(30)
})

test("LUGENT wordmark renders bold right below the mark, centered", async () => {
  const { lastFrame } = renderTui(<App env={fakeEnv()} />)
  await new Promise(r => setTimeout(r, 30))
  const lines = lastFrame().split("\n")
  const markIdx = lines.findIndex(l => l.includes("▀▀▀▀▀▀▀▀"))
  expect(markIdx).toBeGreaterThanOrEqual(0)
  const wm = lines[markIdx + 1] ?? ""
  expect(wm.trim()).toContain("█     █   █")   // block L U, first wordmark row
})

test("provider/model is always visible on the bottom line next to the spinner", async () => {
  const askTool = { name: "askme", description: "ask", schema: { type: "object", properties: {} }, permission: "ask" as const, execute: async () => ({ output: "ok" }) }
  const provider = { chat: async (a: any) => new Promise(res => setTimeout(() => res({ content: "hi", toolCalls: [] }), 60)) }
  const env = fakeEnv({ tools: [askTool], makeProvider: () => provider as any })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("9router · glm/glm-5.2")   // visible while idle
  type("go\r")
  await new Promise(r => setTimeout(r, 40))
  const busyLine = lastFrame().split("\n").find(l => l.includes("working"))
  expect(busyLine).toContain("9router · glm/glm-5.2")     // and on the spinner line while busy
})

test("yolo badge sits on the context line, clearly separated", async () => {
  const root = mkdtempSync("/tmp/lugent-yolo-")
  writeFileSync(join(root, "AGENTS.md"), "# rules")
  const { type, lastFrame } = renderTui(<App env={fakeEnv({ projectRoot: root })} />)
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).not.toContain("YOLO")
  type("/permissions\r")
  await new Promise(r => setTimeout(r, 80))
  type("\x1b[B")   // down to yolo
  type("\r")       // pick it
  await new Promise(r => setTimeout(r, 80))
  const line = lastFrame().split("\n").find(l => l.includes("YOLO"))
  expect(line).toBeDefined()
  expect(line).toContain("AGENTS.md")   // same line as the context info
  expect(line).toContain("│")           // visible separator
})

const askTool = {
  name: "askme", description: "ask", schema: { type: "object", properties: {} },
  permission: "ask" as const, execute: async () => ({ output: "ok" }),
}

test("turn flow: submit → reasoning + answer appear in transcript", async () => {  const provider = {
    chat: async (a: any) => {
      a.onReasoning?.("pondering")
      a.onToken?.("all ")
      a.onToken?.("**done**")
      return { content: "all **done**", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [], makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await new Promise(r => setTimeout(r, 80))
  const f = lastFrame()
  expect(f).toContain("pondering")
  expect(f).toContain("done")
  expect(f).not.toContain("allow")   // no permission dialog on plain answer
})

test("provider that rejects (not returns error) still shows the error and unblocks the input", async () => {
  // runTurn catches chat throws itself — force a throw outside chat (store) to
  // exercise the send() guard that keeps the spinner from sticking forever
  const store = new Proxy(new Store(`/tmp/opencode/tui-env-guard.db`), {
    get(t, k) { return k === "appendMessage" ? () => { throw new Error("db locked") } : (t as any)[k] },
  })
  const env = fakeEnv({ store })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await waitFor(() => lastFrame().includes("internal error: db locked"))
  expect(lastFrame()).toContain("internal error: db locked")
  // input is usable again — the turn really ended
  type("again\r")
  await waitFor(() => lastFrame().split("internal error: db locked").length > 2)
})

test("ctrl-c during ask denies, dialog clears, turn ends", async () => {
  let calls = 0
  const provider = {
    chat: async () => {
      if (calls++ === 0) return { content: "", toolCalls: [{ id: "tc1", name: "askme", args: {} }] }
      return { content: "recovered", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [askTool], makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).toContain("allow askme")     // dialog up
  type("\x03")                                     // ctrl+c
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).not.toContain("allow askme") // dialog gone
})

test("transcript is screen-constrained: old items drop off, composer stays", async () => {
  const provider = {
    chat: async (_a: any) => {
      for (let i = 0; i < 60; i++) { /* noop */ }
      return { content: "done", toolCalls: [] }
    },
  }
  // provider that emits 60 tool lines via a tool is overkill; emit via reasoning-free answer:
  // use onToken with 60 newline-separated lines
  const prov = {
    chat: async (a: any) => {
      for (let i = 0; i < 60; i++) a.onToken?.(`line-${String(i).padStart(2, "0")}\n`)
      return { content: "", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [], makeProvider: () => prov })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await new Promise(r => setTimeout(r, 100))
  const f = lastFrame()
  expect(f).not.toContain("line-00")   // scrolled off / clipped
  expect(f).toContain("line-59")       // latest content visible
  const lineCount = f.split("\n").length
  expect(lineCount).toBeLessThanOrEqual(30)   // frame never taller than screen
})

test("pageUp scrolls transcript up; pageDown scrolls back; typing resets to tail", async () => {
  const prov = {
    chat: async (a: any) => {
      for (let i = 0; i < 60; i++) a.onToken?.(`line-${String(i).padStart(2, "0")}\n`)
      return { content: "", toolCalls: [] }
    },
  }
  const ok = { chat: async () => ({ content: "tail answer", toolCalls: [] }) }
  let n = 0
  const env = fakeEnv({ tools: [], makeProvider: () => (n++ === 0 ? prov : ok) })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await new Promise(r => setTimeout(r, 100))
  expect(lastFrame()).not.toContain("line-00")   // tail view
  type("\x1b[5~")                                 // pageUp: exactly one window (8 lines)
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).not.toContain("line-59")    // tail clipped
  expect(lastFrame()).toContain("line-45")        // one page up visible
  for (let i = 0; i < 7; i++) {                   // 7 more pageUps reach the top
    type("\x1b[5~")
    await new Promise(r => setTimeout(r, 80))
  }
  const f = lastFrame()
  expect(f).toContain("line-00")                  // oldest content visible
  expect(f).toContain("line-04")                  // the head window, not a blank page
  expect(f).not.toContain("line-59")              // tail clipped
  for (let i = 0; i < 8; i++) {                   // pageDown ×8 returns to tail
                             // (one extra: the over-scrolled head clamps, so the
                             // first down only re-aligns to the oldest window)
    type("\x1b[6~")
    await new Promise(r => setTimeout(r, 80))
  }
  expect(lastFrame()).toContain("line-59")        // back at tail
})

test("pageUp mid-stream pins the view: growth does not jump it back to the tail", async () => {
  // The provider parks after 20 lines, so the pageUp is guaranteed to land
  // mid-stream without depending on token timing.
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  const prov = {
    chat: async (a: any) => {
      for (let i = 0; i < 20; i++) a.onToken?.(`line-${String(i).padStart(2, "0")}\n`)
      await gate
      for (let i = 20; i < 60; i++) a.onToken?.(`line-${String(i).padStart(2, "0")}\n`)
      return { content: "", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [], makeProvider: () => prov })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  const idle = () => lastFrame().includes(CARET)

  await waitFor(idle)
  type("go\r")
  await waitFor(() => lastFrame().includes("line-19"))   // the first 20 lines are on screen
  type("\x1b[5~")                                        // pageUp, while the stream is parked
  release()                                              // 40 more lines stream in under the pin
  await waitFor(idle)                                    // the turn finished
  const f = lastFrame()
  expect(f).not.toContain("line-59")                     // still pinned: the tail stayed hidden
  expect(f).toContain("line-")                           // and the view is not blank
})

test("ctrl+c on a later turn aborts instead of exiting (counter resets per turn)", async () => {
  let calls = 0
  const provider = {
    chat: (a: any) => {
      calls++
      // The first turn hangs until ctrl+c aborts it; later turns finish at once.
      if (calls === 1) return new Promise((_, rej) => a.signal?.addEventListener("abort", () => rej(new Error("aborted"))))
      return Promise.resolve({ content: "done", toolCalls: [] })
    },
  }
  const env = fakeEnv({ tools: [], makeProvider: () => provider })
  const { type, lastFrame, waitUntilExit } = renderTui(<App env={env} />, { rows: 30 })
  // The composer ignores keys while a turn runs and the caret marks idle, so the
  // test waits on those states instead of sleeping a fixed amount.
  const idle = () => lastFrame().includes(CARET)

  await waitFor(idle)
  type("turn1\r")
  await waitFor(() => !idle())       // turn 1 is running
  type("\x03")                       // abort turn 1
  await waitFor(idle)                // the turn unwound
  expect(calls).toBe(1)

  type("turn2\r")                    // a fresh turn resets the ctrl+c counter
  await waitFor(() => calls === 2)   // turn 2 started → submit already reset the counter (its busy state is too brief to poll)
  type("\x03")                       // single ctrl+c: abort-nothing, NOT exit
  const exited = await Promise.race([waitUntilExit().then(() => true), new Promise(r => setTimeout(() => r(false), 200))])
  expect(exited).toBe(false)
  expect(lastFrame()).toContain(">") // composer still alive
})

test("keyboard-only scroll: shift+up/down, home/end work like pageUp/pageDown", async () => {
  const prov = {
    chat: async (a: any) => {
      for (let i = 0; i < 60; i++) a.onToken?.(`line-${String(i).padStart(2, "0")}\n`)
      return { content: "", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [], makeProvider: () => prov })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await new Promise(r => setTimeout(r, 120))
  expect(lastFrame()).toContain("line-59")
  expect(lastFrame()).not.toContain("line-00")
  type("\x1b[1;2A")                        // shift+up: scroll one page up
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).not.toContain("line-59")
  type("\x1b[1;2B")                        // shift+down: back to tail
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).toContain("line-59")
  type("\x1b[H")                           // home: jump to the very top
  await new Promise(r => setTimeout(r, 60))
  const f = lastFrame()
  expect(f).toContain("line-00")
  expect(f).not.toContain("line-59")
  type("\x1b[F")                           // end: snap back to the tail
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).toContain("line-59")
  expect(lastFrame()).not.toContain("line-00")
})

test("runTui enables mouse reporting, routes wheel to the transcript, and restores the mode on exit", async () => {
  const prov = {
    chat: async (a: any) => {
      for (let i = 0; i < 60; i++) a.onToken?.(`line-${String(i).padStart(2, "0")}\n`)
      return { content: "", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [], makeProvider: () => prov })
  const out = fakeStdout(30)
  const inStream = fakeStdin()
  const p = runTui(env, { stdin: inStream.stream as any, stdout: out.stream as any })
  await new Promise(r => setTimeout(r, 60))
  expect(out.frames.join("")).toContain(MOUSE_ON)   // reporting switched on

  inStream.type("go\r")
  await new Promise(r => setTimeout(r, 150))
  expect(out.lastFrame()).toContain("line-59")
  expect(out.lastFrame()).not.toContain("line-00")

  inStream.write(WHEEL_UP)                           // one wheel notch up
  await new Promise(r => setTimeout(r, 80))
  expect(out.lastFrame()).not.toContain("line-59")   // the wheel moved the view
  inStream.write(WHEEL_UP.repeat(20))                // 3 lines per notch: enough to pass the top
  await new Promise(r => setTimeout(r, 120))
  expect(out.lastFrame()).toContain("line-00")       // and it reaches the very top

  inStream.write(WHEEL_DOWN.repeat(40))              // wheel down: back toward the tail
  await new Promise(r => setTimeout(r, 120))
  expect(out.lastFrame()).toContain("line-59")       // the wheel scrolled back down

  inStream.type("\x03")                              // exit
  inStream.type("\x03")
  await p
  expect(out.frames.join("")).toContain(MOUSE_OFF)   // modes restored on the way out
})

test("rapid double ctrl+c exits the app", async () => {
  const ok = { chat: async () => ({ content: "done", toolCalls: [] }) }
  const env = fakeEnv({ tools: [], makeProvider: () => ok })
  const { type, waitUntilExit } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("hi\r")
  await new Promise(r => setTimeout(r, 60))
  type("\x03")
  type("\x03")                       // same tick: second must exit
  const exited = await Promise.race([waitUntilExit().then(() => true), new Promise(r => setTimeout(() => r(false), 200))])
  expect(exited).toBe(true)
})

const pathTool = {
  name: "edit", description: "edit", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  permission: "ask" as const, execute: async () => ({ output: "edited" }),
}

test("text before tool rounds is not duplicated by later rounds", async () => {
  const allowTool = { ...pathTool, permission: "allow" as const }
  let calls = 0
  const provider = {
    chat: async (a: any) => {
      if (calls++ === 0) {
        a.onToken?.("Vou ler o arquivo.\n")
        return { content: "Vou ler o arquivo.\n", toolCalls: [{ id: "t1", name: "edit", args: { path: "a.ts" } }] }
      }
      a.onToken?.("Pronto. Feito.")
      return { content: "Pronto. Feito.", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [allowTool], makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await new Promise(r => setTimeout(r, 150))
  const f = lastFrame()
  expect(f).toContain("Vou ler o arquivo.")
  expect(f).toContain("Pronto. Feito.")
  // duplication bug: round-1 text re-prefixed into the round-2 assistant item
  expect(f.split("Vou ler o arquivo.").length - 1).toBe(1)
})

test("two ask tools in one batch: dialogs queue, both resolve, turn completes", async () => {
  let calls = 0
  const provider = {
    chat: async (a: any) => {
      if (calls++ === 0) return {
        content: "", toolCalls: [
          { id: "t1", name: "edit", args: { path: "a.ts" } },
          { id: "t2", name: "edit", args: { path: "b.ts" } },
        ],
      }
      a.onToken?.("all edited")
      return { content: "all edited", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [pathTool], makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  // Poll instead of fixed sleeps: ink commits a frame before its useInput
  // subscription effect lands, so a key typed right after the frame appears
  // can be dispatched before the dialog's handler exists (race → lost key).
  const waitFor = async (want: string, ms = 3000) => {
    const t0 = Date.now()
    while (!lastFrame().includes(want)) {
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for "${want}"`)
      await new Promise(r => setTimeout(r, 20))
    }
    await new Promise(r => setTimeout(r, 30))   // let the subscription effect flush
  }
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await waitFor('allow edit on "a.ts"')
  type("y")
  await waitFor('allow edit on "b.ts"')
  type("y")
  await waitFor("all edited")
})

test("ctrl+c while a queued ask waits ends the turn (no zombie dialog)", async () => {
  let calls = 0
  const provider = {
    chat: async (a: any) => {
      if (calls++ === 0) return {
        content: "", toolCalls: [
          { id: "t1", name: "edit", args: { path: "a.ts" } },
          { id: "t2", name: "edit", args: { path: "b.ts" } },
        ],
      }
      return { content: "", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [pathTool], makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await new Promise(r => setTimeout(r, 80))
  type("y")                          // dialog 1 → dialog 2 queued up
  await new Promise(r => setTimeout(r, 80))
  type("\x03")                       // abort while dialog 2 is up
  await new Promise(r => setTimeout(r, 100))
  const f = lastFrame()
  expect(f).not.toContain("allow edit")   // dialog gone
  expect(f).toContain(">")                // composer back, turn ended
})

test("/model picker: provider → model → applied in status and transcript", async () => {
  const provider = {
    chat: async (a: any) => { a.onToken?.("ok"); return { content: "ok", toolCalls: [] } },
    listModels: async () => ["qwen3.5:14b", "glm/glm-5.2"],
  }
  const env = fakeEnv({ makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("/model\r")
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).toContain("ollama")            // provider list up (not in status)
  type("\r")                                         // enter on 9router (current)
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).toContain("qwen3.5:14b")
  type("\r")                                         // pick qwen3.5:14b
  await new Promise(r => setTimeout(r, 60))
  const f = lastFrame()
  expect(f).not.toContain("❯")                       // picker closed
  expect(f).toContain("9router · qwen3.5:14b")       // status updated
  expect(f).toContain("→ 9router · qwen3.5:14b")     // transcript system line
})

test("ctrl+c while picker is open closes the picker, app stays alive", async () => {
  const provider = {
    chat: async () => ({ content: "ok", toolCalls: [] }),
    listModels: async () => ["m1"],
  }
  const env = fakeEnv({ makeProvider: () => provider })
  const { type, lastFrame, waitUntilExit } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("/model\r")
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).toContain("ollama")
  type("\x03")
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).not.toContain("❯")             // picker gone
  expect(lastFrame()).toContain(">")                 // composer back
  const exited = await Promise.race([waitUntilExit().then(() => true), new Promise(r => setTimeout(() => r(false), 150))])
  expect(exited).toBe(false)
})

test("/skills opens the skill list; esc closes; ctrl+c closes too", async () => {
  const provider = { chat: async () => ({ content: "ok", toolCalls: [] }) }
  const env = fakeEnv({
    makeProvider: () => provider,
    skills: [
      { id: "git-release", name: "Git Release", description: "Prepare releases", file: "/x" },
      { id: "review", name: "review", description: "Review diffs", file: "/y" },
    ],
  })
  const { type, lastFrame, waitUntilExit } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("/skills\r")
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).toContain("git-release")
  expect(lastFrame()).toContain("Prepare releases")
  type("\u001b")                                     // esc closes
  await new Promise(r => setTimeout(r, 100))
  expect(lastFrame()).not.toContain("Prepare releases")
  type("/skills\r")
  await new Promise(r => setTimeout(r, 60))
  type("\x03")                                       // ctrl+c closes, app alive
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).not.toContain("Prepare releases")
  expect(lastFrame()).toContain(">")
  const exited = await Promise.race([waitUntilExit().then(() => true), new Promise(r => setTimeout(() => r(false), 150))])
  expect(exited).toBe(false)
})

test("slash autocomplete in composer: filter, tab-complete, enter opens picker", async () => {
  const provider = {
    chat: async () => ({ content: "ok", toolCalls: [] }),
    listModels: async () => ["m1"],
  }
  const env = fakeEnv({ makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("/sk")                       // filters to /skills while typing
  await new Promise(r => setTimeout(r, 30))
  const f1 = lastFrame()
  expect(f1).toContain("/skills"); expect(f1).not.toContain("/exit")
  type("\b\bmo\t\r")                // back to "/mo", tab completes /model, enter opens picker
  await new Promise(r => setTimeout(r, 60))
  const f2 = lastFrame()
  expect(f2).toContain("ollama")    // provider list up
  expect(f2).not.toContain("❯ /")   // composer suggestions gone (picker took over)
})

test("/resume: pick session, history replays, next turn continues it", async () => {
  // seed a past session in the same project directory
  const env = fakeEnv()
  const old = env.store.createSession("9router", "glm/glm-5.2", env.projectRoot)
  env.store.appendMessage({ id: "u1", sessionId: old.id, role: "user", content: "past question", createdAt: new Date(0).toISOString() })
  env.store.appendMessage({ id: "a1", sessionId: old.id, role: "assistant", content: "past answer", createdAt: new Date(1).toISOString() })

  const ok = { chat: async (a: any) => { a.onToken?.("new answer"); return { content: "new answer", toolCalls: [] } } }
  const env2 = fakeEnv({ makeProvider: () => ok })
  Object.assign(env2, { store: env.store })
  const { type, lastFrame } = renderTui(<App env={env2} />)
  const waitFor = async (want: string, ms = 3000) => {
    const t0 = Date.now()
    while (!lastFrame().includes(want)) {
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for "${want}"`)
      await new Promise(r => setTimeout(r, 20))
    }
    await new Promise(r => setTimeout(r, 30))   // let the useInput subscription effect flush
  }
  await new Promise(r => setTimeout(r, 30))
  type("/resume\r")
  await waitFor("past question")                     // picker shows preview
  type("\r")                                        // pick newest
  await waitFor("past answer")                       // history replayed
  type("next turn\r")
  await waitFor("new answer")
  const msgs = env.store.getMessages(old.id)
  expect(msgs.some(m => m.content === "next turn")).toBe(true)   // continued, not forked
})

const pathTool2 = {
  name: "edit", description: "edit", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  permission: "ask" as const, execute: async () => ({ output: "edited" }),
}

test("/permissions panel: switch to yolo and back, status reflects it", async () => {
  const provider = { chat: async () => ({ content: "ok", toolCalls: [] }) }
  const env = fakeEnv({ makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  const waitFor = async (want: string, ms = 3000) => {
    const t0 = Date.now()
    while (!lastFrame().includes(want)) {
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for "${want}"`)
      await new Promise(r => setTimeout(r, 20))
    }
    await new Promise(r => setTimeout(r, 30))
  }
  await new Promise(r => setTimeout(r, 30))
  type("/permissions\r")
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).toContain("normal")
  expect(lastFrame()).toContain("yolo")
  type("\u001b[B\r")                      // ↓ to yolo, enter
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).not.toContain("❯ /")            // panel closed
  expect(lastFrame()).toContain("YOLO")               // status shows mode
  type("/permissions\r")                    // back to normal
  await new Promise(r => setTimeout(r, 60))
  type("\u001b[A\r")                         // sel starts at current (yolo) — ↑ to normal
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).not.toContain("YOLO")
})

test("yolo mode: ask tool runs without a permission dialog", async () => {
  let calls = 0
  const provider = {
    chat: async (a: any) => {
      if (calls++ === 0) return { content: "", toolCalls: [{ id: "t1", name: "edit", args: { path: "a.ts" } }] }
      a.onToken?.("done")
      return { content: "done", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [pathTool2], makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  const waitFor = async (want: string, ms = 3000) => {
    const t0 = Date.now()
    while (!lastFrame().includes(want)) {
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for "${want}"`)
      await new Promise(r => setTimeout(r, 20))
    }
    await new Promise(r => setTimeout(r, 30))
  }
  await new Promise(r => setTimeout(r, 30))
  type("/permissions\r")
  await waitFor("yolo")
  type("\u001b[B\r")
  await waitFor("YOLO")
  type("go\r")
  await waitFor("✎ edit a.ts")
  await waitFor("done")
  expect(lastFrame()).not.toContain("allow edit")     // no dialog ever appeared
})

test("/agent picker: pick switches the profile, status and toolset line follow", async () => {
  const env = fakeEnv({
    tools: [{
      name: "read", description: "Read a file", schema: { type: "object", properties: {} },
      permission: "allow", execute: async () => ({ output: "" }),
    }, {
      name: "shell", description: "Run a command", schema: { type: "object", properties: {} },
      permission: "ask", execute: async () => ({ output: "" }),
    }],
    agents: [{ id: "reviewer", prompt: "review", description: "Reviews read-only", tools: ["read"] }],
  })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("/agent\r")
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).toContain("choose agent")
  expect(lastFrame()).toContain("Reviews read-only")
  type("\r")   // pick the selected (first) agent
  await new Promise(r => setTimeout(r, 80))
  const f = lastFrame()
  expect(f).toContain("agent reviewer")
  expect(f).toContain("tools: read")     // switch line confirms the toolset result
  expect(f).not.toContain("tools: read,shell")
  expect(f).toContain("reviewer")
})

test("defaultAgent at startup applies the agent's model", async () => {
  const env = fakeEnv({
    config: {
      defaultProvider: "9router", defaultModel: "base-model", defaultAgent: "reviewer",
      providers: { "9router": { baseUrl: "http://x/v1" }, "ollama": { baseUrl: "http://y/v1" } },
    },
    agents: [{ id: "reviewer", prompt: "r", model: { provider: "ollama", model: "rev-model" } }],
  })
  const { lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("ollama · rev-model")
  expect(lastFrame()).toContain("reviewer")
})

test("resume restores the agent's model, not the session's creation model", async () => {  const env = fakeEnv({ agents: [{ id: "reviewer", prompt: "r", model: { provider: "ollama", model: "rev-model" } }] })
  const old = env.store.createSession("9router", "glm/glm-5.2", env.projectRoot, "reviewer")
  env.store.appendMessage({ id: "u1", sessionId: old.id, role: "user", content: "past question", createdAt: new Date(0).toISOString() })

  const { type, lastFrame } = renderTui(<App env={env} />)
  const waitFor = async (want: string, ms = 3000) => {
    const t0 = Date.now()
    while (!lastFrame().includes(want)) {
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for "${want}"`)
      await new Promise(r => setTimeout(r, 20))
    }
    await new Promise(r => setTimeout(r, 30))
  }
  await new Promise(r => setTimeout(r, 30))
  type("/resume\r")
  await waitFor("past question")
  type("\r")                                  // pick it
  await waitFor("ollama · rev-model")          // agent's model, not glm/glm-5.2
  expect(lastFrame()).toContain("reviewer")
})

test("context line shows AGENTS.md loaded and the current agent, above the input", async () => {
  const root = mkdtempSync("/tmp/lugent-ctx-")
  writeFileSync(join(root, "AGENTS.md"), "# rules")
  const env = fakeEnv({ projectRoot: root, agents: [{ id: "reviewer", color: "cyan", prompt: "r" }] })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("/agent\r")
  await new Promise(r => setTimeout(r, 80))
  type("\r")                                  // pick the first listed agent
  await new Promise(r => setTimeout(r, 80))
  const f = lastFrame()
  expect(f).toContain("AGENTS.md loaded")
  expect(f).toContain("agent reviewer")
  // fixed: banner stays above the composer in the same frame
  expect(f.indexOf("AGENTS.md loaded")).toBeLessThan(f.lastIndexOf(">"))
})

test("no defaultAgent: the session starts on the build agent", async () => {
  const env = fakeEnv({ agents: [{ id: "build", prompt: "base" }, { id: "plan", prompt: "p" }] })
  const { lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("build")
})

test("an unknown defaultAgent falls back to build", async () => {
  const env = fakeEnv({
    config: { defaultProvider: "9router", defaultModel: "m", defaultAgent: "ghost", providers: { "9router": { baseUrl: "http://x/v1" } } },
    agents: [{ id: "build", prompt: "base" }, { id: "plan", prompt: "p" }],
  })
  const { lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("build")
})

test("/mcp overlay lists servers, and disabling one refreshes the list", async () => {
  const statuses: Record<string, string> = { echo: "connected", tf: "failed" }
  const calls: string[] = []
  const env = fakeEnv({
    mcp: {
      states: () => [
        { name: "echo", type: "local", status: statuses.echo, toolCount: statuses.echo === "connected" ? 1 : 0 },
        { name: "tf", type: "remote", status: statuses.tf, error: statuses.tf === "failed" ? "boom" : undefined, toolCount: 0 },
      ],
      reconnect: async (n: string) => { calls.push(`reconnect:${n}`); statuses[n] = "connected" },
      disable: async (n: string) => { calls.push(`disable:${n}`); statuses[n] = "disabled" },
      enable: async (n: string) => { calls.push(`enable:${n}`); statuses[n] = "connected" },
      authenticate: async (n: string) => { calls.push(`authenticate:${n}`); statuses[n] = "connected" },
      logout: async (n: string) => { calls.push(`logout:${n}`); statuses[n] = "auth_required" },
    },
  })
  const { type, lastFrame } = renderTui(<App env={env} />)
  const waitFor = async (want: string, ms = 3000) => {
    const t0 = Date.now()
    while (!lastFrame().includes(want)) {
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for "${want}"`)
      await new Promise(r => setTimeout(r, 20))
    }
    await new Promise(r => setTimeout(r, 30))   // let the useInput subscription effect flush
  }
  await new Promise(r => setTimeout(r, 30))
  type("/mcp\r")
  await waitFor("echo (local) — connected, 1 tool")
  expect(lastFrame()).toContain("tf (remote) — failed: boom")

  type("\r")                                   // enter → action menu for the selected server
  await waitFor("disable")
  type("\r")                                   // pick disable
  await waitFor("echo (local) — disabled")
  expect(calls).toEqual(["disable:echo"])
})
