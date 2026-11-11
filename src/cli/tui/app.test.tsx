import { test, expect } from "bun:test"
import { rmSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { EventEmitter } from "node:events"
import { App, runTui } from "./app"
import { renderTui } from "./harness"
import { Store } from "../../core/store"
import { makeSubagentTool } from "../../core/tools/subagent"


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
      // The renderer also writes bare escape sequences (cursor moves); the
      // frame to assert on is the last one with visible text.
      for (let i = frames.length - 1; i >= 0; i--) {
        const s = stripAnsi(frames[i])
        if (s.trim()) return s
      }
      return ""
    },
  }
  return out
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

/** Rows from the composer up = the live frame (Static scrollback lines above it
 *  are history already handed to the terminal and don't count against the cap).
 *  The frame no longer starts at a logo row — the logo is the first scrollback
 *  item — so the composer border is the frame's anchor. */
const frameFrom = (f: string): string[] => {
  const lines = f.split("\n")
  const composer = lines.findIndex(l => l.includes("╭"))
  return lines.slice(Math.max(0, composer))
}

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

test("splash pad collapses once a turn runs; the frame stays put after it", async () => {
  const provider = { chat: async (a: any) => { a.onToken?.("hello"); return { content: "hello", toolCalls: [] } } }
  const env = fakeEnv({ tools: [], makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame().split("\n").findIndex(l => l.includes("██▄"))).toBe(7)   // splash: centered
  type("go\r")
  await waitFor(() => lastFrame().includes(CARET))   // turn done
  // The finished turn lives in the scrollback (Static lines at the top); the
  // frame below it shows the chrome only, and the frame's own height never
  // grows past the terminal. The logo left the frame for the scrollback, so
  // the frame's top edge is the transcript/composer, not a logo row.
  const lines = lastFrame().split("\n")
  expect(lines.findIndex(l => l.includes("██▄"))).toBeGreaterThanOrEqual(0)   // printed once, above
  expect(frameFrom(lastFrame()).length).toBeLessThanOrEqual(29)              // frame cap
  expect(frameFrom(lastFrame()).some(l => l.includes("██▄"))).toBe(false)    // logo not in frame
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

test("logo printed to the scrollback is horizontally centered", async () => {
  const provider = { chat: async (a: any) => { a.onToken?.("hello"); return { content: "hello", toolCalls: [] } } }
  const env = fakeEnv({ makeProvider: () => provider as any })
  const { type, allOutput } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await waitFor(() => type.length > 0 && allOutput().includes("hello"))
  // The <Static> print of the logo is the first one handed to the terminal
  // (the splash frame shows it centered already). It used to stick flush-left:
  // <Static> renders outside the frame and got measured at content width.
  const bar = allOutput().split("\n").filter(l => l.includes("▀▀▀▀▀▀▀▀"))
  const starts = new Set(bar.map(l => [...l].indexOf("▀")).filter(i => i >= 0))
  const centered = Math.floor(100 / 2 - 8)   // 16-wide bar on a 100-col terminal
  for (const s of starts) expect(Math.abs(s - centered)).toBeLessThanOrEqual(4)
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

test("permission mode: startup from config, /permissions persists to the global config", async () => {
  const global = `/tmp/opencode/tui-mode-${Date.now()}.json`
  rmSync(global, { force: true })
  const provider = { chat: async () => ({ content: "ok", toolCalls: [] }) }
  const env = fakeEnv({
    makeProvider: () => provider,
    config: { ...fakeEnv().config, permissionMode: "yolo" },
  })
  const { type, lastFrame } = renderTui(<App env={env} globalConfigPath={global} />)
  const waitFor = async (want: string, ms = 3000) => {
    const t0 = Date.now()
    while (!lastFrame().includes(want)) {
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for "${want}"`)
      await new Promise(r => setTimeout(r, 20))
    }
    await new Promise(r => setTimeout(r, 30))
  }
  await waitFor("YOLO")                                 // config yolo applies at startup
  type("/permissions\r")
  await waitFor("normal")
  type("\u001b[A\r")                                    // yolo selected → ↑ to normal
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).not.toContain("YOLO")
  expect(JSON.parse(readFileSync(global, "utf8")).permissionMode).toBe("normal")   // persisted
  rmSync(global, { force: true })
})

test("permission mode: an unpersistable global config keeps the session mode and says so", async () => {
  const global = "/tmp/opencode/tui-mode-fail"   // a directory → writeFileSync fails
  rmSync(global, { recursive: true, force: true })
  mkdirSync(global, { recursive: true })
  const warns: string[] = []
  const orig = console.warn
  console.warn = (m: string) => { warns.push(String(m)) }
  const { type, lastFrame } = renderTui(<App env={fakeEnv()} globalConfigPath={global} />)
  const waitFor = async (want: string, ms = 3000) => {
    const t0 = Date.now()
    while (!lastFrame().includes(want)) {
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for "${want}"`)
      await new Promise(r => setTimeout(r, 20))
    }
    await new Promise(r => setTimeout(r, 30))
  }
  try {
    type("/permissions\r")
    await waitFor("yolo")
    type("\x1b[B\r")                                    // pick yolo
    await new Promise(r => setTimeout(r, 80))
    expect(lastFrame()).toContain("YOLO")               // session mode still applied
    expect(lastFrame()).toContain("session only")       // with the failure called out
    expect(warns.join("\n")).toMatch(/permission mode/)
    expect(existsSync(join(global, "config.json"))).toBe(false)   // nothing half-written
  } finally {
    console.warn = orig
    rmSync(global, { recursive: true, force: true })
  }
})

const askTool = {
  name: "askme", description: "ask", schema: { type: "object", properties: {} },
  permission: "ask" as const, execute: async () => ({ output: "ok" }),
}

test("idle frame is chrome-only: no blank gap between the last message and the composer", async () => {
  // Between turns the conversation lives in the scrollback and the live
  // transcript is empty — the idle frame must be only the chrome, or ~rows of
  // blank rows open up between the last message and the composer (the logo
  // used to fill them; when it moved to the scrollback they became a void).
  // The busy frame stays the full viewport-height column (frameRows) — that
  // path is covered by the window/pinning tests; this test pins the idle one.
  const provider = { chat: async (a: any) => { a.onToken?.("short answer"); return { content: "short answer", toolCalls: [] } } }
  const env = fakeEnv({ tools: [], makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  type("q1\r")
  await waitFor(() => lastFrame().includes(CARET))
  await new Promise(r => setTimeout(r, 150))   // commit render lands after busy clears
  const f = lastFrame().split("\n")
  const answer = f.findLastIndex(l => l.includes("short answer"))
  const composer = f.findLastIndex(l => l.includes("╭"))
  // the composer sits right under the conversation: composer, context line and
  // the blank separator are the whole frame — no screen-tall empty region.
  expect(composer).toBeGreaterThan(answer)
  expect(composer - answer).toBeLessThanOrEqual(4)   // answer → blank sep → (frame top) → composer
})

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

test("finished turns move to the scrollback exactly once; the frame holds only the live turn", async () => {
  const provider = { chat: async (a: any) => { a.onToken?.("answer"); return { content: "answer", toolCalls: [] } } }
  const env = fakeEnv({ tools: [], makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  type("q1\r")
  // busy→idle alone can render before the commit does: wait until the turn's
  // question shows in the scrollback too, or q2's keys hit a disabled composer.
  await waitFor(() => { const f = lastFrame(); return f.includes(CARET) && f.includes("> q1") })
  type("q2\r")
  await waitFor(() => lastFrame().includes(CARET))
  await new Promise(r => setTimeout(r, 150))   // commit render lands after busy clears
  // The final frame carries the whole scrollback above the frame: each turn
  // appears exactly once (twice would mean live + static both printed it).
  const f = lastFrame()
  const count = (needle: string) => f.split("\n").filter(l => l.includes(needle)).length
  expect(count("> q1")).toBe(1)
  expect(count("> q2")).toBe(1)
  expect(count("answer")).toBe(2)   // one per turn, never duplicated
  // the live frame (from the chrome down) shows no turn content between turns
  const frame = frameFrom(f)
  expect(frame.some(l => l.includes("q1") || l.includes("q2"))).toBe(false)
})

test("the logo prints once at the top of the conversation and never reappears mid-history", async () => {
  // The logo belongs to the splash, not the live frame: it is committed to the
  // scrollback as the FIRST static item (above every turn) and stops rendering
  // in the frame once any item exists. A logo pinned inside the frame showed
  // up between the scrollback'd history and every new turn — forever.
  const provider = { chat: async (a: any) => { a.onToken?.("answer"); return { content: "answer", toolCalls: [] } } }
  const env = fakeEnv({ tools: [], makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  const splash = lastFrame().split("\n")
  expect(splash.findIndex(l => l.includes("██▄"))).toBe(7)       // splash: centered, in frame
  type("q1\r")
  await waitFor(() => lastFrame().includes(CARET))
  await new Promise(r => setTimeout(r, 150))
  const f = lastFrame().split("\n")
  // The raster's top row appears 4× per logo — count the wordmark's bottom row
  // (base bar █████ █████), which exists exactly once per logo.
  const marks = f.map((l, i) => l.includes("█████ █████") ? i : -1).filter(i => i >= 0)
  expect(marks).toHaveLength(1)                                  // printed exactly once
  const logoRow = marks[0]
  const q1Row = f.findIndex(l => l.includes("> q1"))
  expect(logoRow).toBeLessThan(q1Row)                            // above the first turn: start of conversation
  // the logo's mark row + wordmark + chrome frame: everything after the logo is
  // conversation, no second logo anywhere below it.
  expect(f.slice(logoRow + 1).some(l => l.includes("██▄"))).toBe(false)
  expect(f.findIndex(l => l.includes("9router · glm/glm-5.2"))).toBeGreaterThan(logoRow)
  type("q2\r")
  await waitFor(() => lastFrame().includes(CARET))
  await new Promise(r => setTimeout(r, 150))
  const f2 = lastFrame().split("\n")
  expect(f2.filter(l => l.includes("█████ █████"))).toHaveLength(1)   // still exactly one logo
  const logo2 = f2.findIndex(l => l.includes("█████ █████"))
  expect(logo2).toBeLessThan(f2.findIndex(l => l.includes("> q1")))
  expect(logo2).toBeLessThan(f2.findIndex(l => l.includes("> q2")))
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

test("live window is screen-constrained: old lines of the current turn drop off", async () => {
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
  await waitFor(() => lastFrame().includes("line-59"))    // the whole turn streamed
  // While busy the window only holds the newest lines; once the turn ends the
  // whole thing is committed to the scrollback and the frame is chrome-only.
  await waitFor(() => lastFrame().includes(CARET))
  // lastFrame() concatenates the scrollback'd turn + the frame: the FRAME is
  // the last rows — its height must hold the viewport cap, and it carries no
  // logo (the logo is scrollback-only once the conversation exists).
  expect(frameFrom(lastFrame()).length).toBeLessThanOrEqual(29)
  expect(frameFrom(lastFrame()).some(l => l.includes("██▄"))).toBe(false)
})

test("pageUp scrolls the live window up; pageDown back; typing resets to tail", async () => {
  // Only the current turn is in the frame, so the scroll budget is one window
  // (23 lines on 30 rows — the logo left the frame, so the window is the rows
  // the chrome doesn't take). History beyond the turn is the terminal
  // scrollback — which also means scrolling only does anything while the turn
  // is live, so the provider parks with the stream half-done.
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  const prov = {
    chat: async (a: any) => {
      for (let i = 0; i < 60; i++) a.onToken?.(`line-${String(i).padStart(2, "0")}\n`)
      await gate
      return { content: "", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [], makeProvider: () => prov })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await waitFor(() => lastFrame().includes("line-59"))   // tail view while busy
  type("\x1b[5~")                                 // pageUp: exactly one window
  await new Promise(r => setTimeout(r, 100))
  expect(lastFrame()).not.toContain("line-59")    // tail clipped
  expect(lastFrame()).toContain("line-36")        // one page (23 lines) up visible
  type("\x1b[6~")                                 // pageDown: back to the tail
  await new Promise(r => setTimeout(r, 100))
  expect(lastFrame()).toContain("line-59")
  release()
  await waitFor(() => lastFrame().includes(CARET)) // turn finished, gate open
})

test("pageUp mid-stream pins the view: growth does not jump it back to the tail", async () => {
  // The provider parks after 20 lines and stays live while the pin is checked —
  // once the turn ends the live window is committed to the scrollback anyway.
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  const prov = {
    chat: async (a: any) => {
      for (let i = 0; i < 20; i++) a.onToken?.(`line-${String(i).padStart(2, "0")}\n`)
      await gate
      for (let i = 20; i < 40; i++) a.onToken?.(`line-${String(i).padStart(2, "0")}\n`)
      await new Promise(r => setTimeout(r, 500))         // window for the assertion: turn still live
      return { content: "", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [], makeProvider: () => prov })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await waitFor(() => lastFrame().includes(CARET))       // composer idle → submit flushed
  type("go\r")
  await waitFor(() => lastFrame().includes("line-19"))   // the first 20 lines are on screen
  type("\x1b[5~")                                        // pageUp, while the stream is parked
  await new Promise(r => setTimeout(r, 80))
  const pinned = lastFrame().split("\n").filter(l => l.includes("line-")).map(l => l.trim())
  expect(pinned.join()).toContain("line-00")              // head of the pinned window
  release()                                              // 20 more lines stream in under the pin
  await new Promise(r => setTimeout(r, 250))
  const still = lastFrame().split("\n").filter(l => l.includes("line-")).map(l => l.trim())
  // The view did not jump to the tail: the pinned head stays the first line,
  // and growth lands below it (the window is wide enough to show a few of the
  // new lines under the pin — that is the pin working, not a jump).
  expect(still[0]).toBe(pinned[0])
  expect(still.join()).not.toContain("line-59")
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

test("keyboard-only scroll: shift+up/down and pageUp/pageDown; plain home/end do not scroll", async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  const prov = {
    chat: async (a: any) => {
      for (let i = 0; i < 60; i++) a.onToken?.(`line-${String(i).padStart(2, "0")}\n`)
      await gate
      return { content: "", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [], makeProvider: () => prov })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await waitFor(() => lastFrame().includes("line-59"))
  type("\x1b[1;2A")                        // shift+up: scroll one page up
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).not.toContain("line-59")
  type("\x1b[1;2B")                        // shift+down: back to tail
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).toContain("line-59")
  type("\x1b[H")                           // home: composer-owned now — frame stays at the tail
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).toContain("line-59")
  type("\x1b[F")                           // end: likewise a no-op for scrolling
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).toContain("line-59")
  type("\x1b[5~")                          // pageUp still scrolls (plain Home/End left the frame handler)
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).not.toContain("line-59")
  release()
  await waitFor(() => lastFrame().includes(CARET))
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

test("/model picker persists the choice to the session row (session remembers)", async () => {
  const provider = {
    chat: async (a: any) => { a.onToken?.("ok"); return { content: "ok", toolCalls: [] } },
    listModels: async () => ["qwen3.5:14b", "glm/glm-5.2"],
  }
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
  type("hi\r")                                       // a turn first: session becomes listable
  await waitFor("ok")
  type("/model\r")
  await new Promise(r => setTimeout(r, 60))
  type("\r")                                         // enter on 9router (current provider)
  await new Promise(r => setTimeout(r, 60))
  type("\r")                                         // pick qwen3.5:14b
  await waitFor("9router · qwen3.5:14b")
  // the DB row carries the picked model, not the creation default
  const rows = env.store.listSessions(env.projectRoot)
  expect(rows.length).toBe(1)
  expect(rows[0].provider).toBe("9router")
  expect(rows[0].model).toBe("qwen3.5:14b")
})

test("/resume restores the resumed session's provider and model", async () => {
  // past session worked on ollama/glm — the app now starts on the 9router default
  const env = fakeEnv()
  const old = env.store.createSession("ollama", "glm/glm-5.2", env.projectRoot)
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
  expect(lastFrame()).toContain("9router · glm/glm-5.2")   // starts on defaults
  type("/resume\r")
  await waitFor("past question")
  type("\r")                                               // pick it
  await waitFor("ollama · glm/glm-5.2")                    // provider AND model restored
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

test("agent picker pick: agent whose declared provider is missing renders a fatal error and the app stays alive", async () => {
  const env = fakeEnv({
    agents: [{ id: "badmodel", prompt: "b", model: { provider: "ghost", model: "m" } }],
  })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("/agent\r")
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).toContain("choose agent")
  type("\r")                                  // pick the fatal-model agent
  await new Promise(r => setTimeout(r, 80))
  const f = lastFrame()
  // fail-soft: the fatal message is rendered, the process did not exit
  expect(f).toContain("agent badmodel: model ghost/m not found (provider not configured)")
  // and the agent was NOT activated: the context line still shows the base model
  expect(f).not.toContain("ghost · m")
  // the app is still interactive: reopening the picker works
  type("/agent\r")
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).toContain("choose agent")
})

test("resume pick: session whose agent declared a missing provider renders a fatal error and the app stays alive", async () => {
  const env = fakeEnv({
    agents: [{ id: "badmodel", prompt: "b", model: { provider: "ghost", model: "m" } }],
  })
  const old = env.store.createSession("9router", "glm/glm-5.2", env.projectRoot, "badmodel")
  env.store.appendMessage({ id: "u1", sessionId: old.id, role: "user", content: "past question", createdAt: new Date(0).toISOString() })

  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("/resume\r")
  const wait = async (want: string) => {
    const t0 = Date.now()
    while (!lastFrame().includes(want) && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 20))
    expect(lastFrame()).toContain(want)
  }
  await wait("past question")
  type("\r")                                  // pick the session pinned to badmodel
  await wait("agent badmodel: model ghost/m not found (provider not configured)")
  // fail-soft: the fatal message is rendered; the model was not switched to the ghost provider
  expect(lastFrame()).not.toContain("ghost · m")
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
  await new Promise(r => setTimeout(r, 300))
  await waitFor("echo (local) — connected, 1 tool")
  expect(lastFrame()).toContain("tf (remote) — failed: boom")

  type("\r")                                   // enter → action menu for the selected server
  await waitFor("disable")
  type("\r")                                   // pick disable
  await waitFor("echo (local) — disabled")
  expect(calls).toEqual(["disable:echo"])
})

test("composer stays pinned: scrolling never moves the input or resizes the frame", async () => {
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
  await new Promise(r => setTimeout(r, 150))
  const geom = () => {
    const lines = lastFrame().split("\n")
    const composer = lines.findLastIndex(l => l.includes("╭"))
    const context = lines.findLastIndex(l => l.includes("9router · glm/glm-5.2"))
    return {
      // The frame is bottom-anchored, so the chrome is stable when its distance
      // from the END of the output is (the scrollback above can grow freely).
      height: frameFrom(lastFrame()).length,
      composerFromBottom: lines.length - 1 - composer,
      contextFromBottom: lines.length - 1 - context,
    }
  }
  const tail = geom()
  expect(tail.composerFromBottom).toBeGreaterThan(0)
  // Exactly one row short of the viewport: a frame as tall as the terminal is
  // 'fullscreen' to ink (full clears between frames, and the whole frame is
  // wiped on exit). See frameRows.
  expect(tail.height).toBeLessThanOrEqual(29)
  for (let i = 0; i < 4; i++) {
    type("\x1b[5~")                          // pageUp ×4
    await new Promise(r => setTimeout(r, 80))
    expect(geom()).toEqual(tail)             // the chrome did not budge
  }
})

test("overlays open inside the frame instead of pushing the chrome off-screen", async () => {
  const prov = {
    chat: async () => ({ content: "", toolCalls: [] }),
    listModels: async () => Array.from({ length: 20 }, (_, i) => `m-${i}`),
  }
  const env = fakeEnv({ makeProvider: () => prov })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  type("/model\r")
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).toContain("choose provider")
  expect(frameFrom(lastFrame()).length).toBeLessThanOrEqual(29)   // same frame cap
  type("\r")                                     // provider → models (long list)
  await new Promise(r => setTimeout(r, 100))
  const f = lastFrame()
  expect(f).toContain("m-0")                                       // list rendered…
  expect(f).toContain("↑/↓ move")                                  // …with its key hints
  expect(f).toContain("esc back")                                  // (models level: esc goes back)
  expect(frameFrom(f).length).toBeLessThanOrEqual(29)
})

test("long wrapped lines cannot push the composer out of the frame", async () => {
  // itemLines counts logical lines; ink renders wrapped ones as several rows.
  // Counting only \n under-budgets the window and the frame overflows the
  // terminal, scrolling the composer off-screen.
  const long = "palavra ".repeat(30)         // ~240 cols → 3 rows at 100 cols
  const prov = {
    chat: async (a: any) => {
      for (let i = 0; i < 6; i++) a.onToken?.(`line-${i} ${long}\n`)
      return { content: "", toolCalls: [] }
    },
  }
  const env = fakeEnv({ tools: [], makeProvider: () => prov })
  const { type, lastFrame } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await new Promise(r => setTimeout(r, 200))
  const lines = frameFrom(lastFrame())
  expect(lines.length).toBeLessThanOrEqual(29)
  expect(lastFrame()).toContain("line-5")    // newest content still on screen
  expect(lines.findIndex(l => l.includes("╭"))).toBeLessThan(29)
})


// ---- subagent live viewer (ctrl+N) ----

const CTRL1 = "\x1b[49;5u"   // kitty CSI-u ctrl+1
const CTRL8 = "\x1b[56;5u"   // ctrl+8
const CTRL9 = "\x1b[57;5u"   // ctrl+9
const ESC = "\x1b"

const yoloEnv = (over: Record<string, unknown> = {}) =>
  fakeEnv({ config: { ...fakeEnv().config, permissionMode: "yolo" }, ...over })

const reviewerAgent = (tools: string[] = ["read"]) => ({ id: "reviewer", mode: "subagent", prompt: "You are REVIEWER.", tools })

const readTool = {
  name: "read", description: "read", schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  permission: "allow" as const, execute: async () => ({ output: "file" }),
}

/** Parent round 1 spawns the reviewer; the child reads a.txt, pauses, then streams its answer. */
function reviewerProvider() {
  let parentRounds = 0
  let childRounds = 0
  return {
    chat: async (a: any) => {
      const sys: string = a.messages[0].content
      if (sys.includes("You are REVIEWER.")) {
        childRounds++
        if (childRounds === 1) return { content: "", toolCalls: [{ id: "c1", name: "read", args: { path: "a.txt" } }] }
        await new Promise(r => setTimeout(r, 250))   // hold the child open so the live line is observable
        a.onToken?.("child answer")
        return { content: "child answer", toolCalls: [] }
      }
      parentRounds++
      if (parentRounds === 1) return { content: "", toolCalls: [{ id: "t1", name: "subagent", args: { agent: "reviewer", prompt: "review a.txt" } }] }
      return { content: "parent done", toolCalls: [] }
    },
  }
}

test("subagent tool line shows live child status while the child runs", async () => {
  const env = yoloEnv({ tools: [readTool, makeSubagentTool()], agents: [reviewerAgent()], makeProvider: () => reviewerProvider() })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  // while the child runs: agent id · current activity · elapsed seconds
  await waitFor(() => /subagent reviewer · read a\.txt · \d+s/.test(lastFrame()))
  expect(lastFrame()).not.toContain("child answer")   // the child stream stays off the parent frame
  await waitFor(() => lastFrame().includes(CARET))    // turn done
  const f = lastFrame()
  expect(f).toContain("subagent reviewer")            // completed: the normal tool line
  expect(f).not.toContain("reviewer · read a.txt")    // live status is gone
})

test("ctrl+c closing the child viewer leaves no exit count armed (next ctrl+c aborts, not exits)", async () => {
  // Parent round 1 spawns the reviewer; round 2 hangs until ctrl+c aborts it.
  let parentRounds = 0
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  const provider = {
    chat: async (a: any) => {
      const sys: string = a.messages[0].content
      if (sys.includes("You are REVIEWER.")) {
        await new Promise(r => setTimeout(r, 120))   // hold the child open so the viewer can be opened mid-turn
        a.onToken?.("child answer")
        return { content: "child answer", toolCalls: [] }
      }
      parentRounds++
      if (parentRounds === 1) return { content: "", toolCalls: [{ id: "t1", name: "subagent", args: { agent: "reviewer", prompt: "review" } }] }
      return new Promise<any>((resolve, reject) => {
        if (a.signal?.aborted) { reject(new Error("aborted")); return }   // ctrl+c landed before this round started
        const onAbort = () => reject(new Error("aborted"))
        a.signal?.addEventListener("abort", onAbort, { once: true })
        gate.then(() => { a.signal?.removeEventListener("abort", onAbort); resolve({ content: "parent done", toolCalls: [] }) })
      })
    },
  }
  const env = yoloEnv({ tools: [readTool, makeSubagentTool()], agents: [reviewerAgent()], makeProvider: () => provider })
  const { type, lastFrame, waitUntilExit } = renderTui(<App env={env} />, { rows: 30 })
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await waitFor(() => /subagent reviewer ·/.test(lastFrame()))   // child is up, turn busy
  type(CTRL1)
  await waitFor(() => lastFrame().includes("esc close"))         // viewer open mid-turn
  type("\x03")                                                   // ctrl+c #1: closes the viewer only
  await waitFor(() => !lastFrame().includes("esc close"))
  expect(lastFrame()).toContain(">")                             // composer back
  type("\x03")                                                   // ctrl+c #2: must abort the busy turn, NOT exit
  await waitFor(() => lastFrame().includes(CARET))               // turn unwound
  const exited = await Promise.race([waitUntilExit().then(() => true), new Promise(r => setTimeout(() => r(false), 200))])
  expect(exited).toBe(false)                                     // app still alive
  expect(lastFrame()).toContain(">")
  release()
})

test("ctrl+1 opens the running child's live transcript; esc closes", async () => {
  const env = yoloEnv({ tools: [readTool, makeSubagentTool()], agents: [reviewerAgent()], makeProvider: () => reviewerProvider() })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await waitFor(() => /subagent reviewer ·/.test(lastFrame()))   // child is up
  type(CTRL1)
  await waitFor(() => lastFrame().includes("esc close"))         // overlay hint
  expect(lastFrame()).toContain("reviewer")
  expect(lastFrame()).toContain("a.txt")                         // child's own tool line inside the overlay
  await waitFor(() => lastFrame().includes("child answer"))      // streams live while the child runs
  type(ESC)
  await waitFor(() => !lastFrame().includes("esc close"))
  await waitFor(() => lastFrame().includes(CARET))               // turn finished normally
})

test("children are numbered by launch order; ctrl+9 opens the picker past 8", async () => {
  const agents = Array.from({ length: 9 }, (_, i) => ({ id: `s${i + 1}`, mode: "subagent", prompt: `You are S${i + 1}.` }))
  let parentRounds = 0
  const provider = {
    chat: async (a: any) => {
      const sys: string = a.messages[0].content
      const m = sys.match(/You are S(\d)\./)
      if (m) { a.onToken?.(`done from s${m[1]}`); return { content: `done from s${m[1]}`, toolCalls: [] } }
      parentRounds++
      if (parentRounds === 1) return {
        content: "",
        toolCalls: agents.map((ag, i) => ({ id: `t${i}`, name: "subagent", args: { agent: ag.id, prompt: `task ${i}` } })),
      }
      return { content: "parent done", toolCalls: [] }
    },
  }
  const env = yoloEnv({ tools: [makeSubagentTool()], agents, makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await waitFor(() => lastFrame().includes(CARET))
  type(CTRL1)
  await waitFor(() => lastFrame().includes("done from s1"))
  expect(lastFrame()).toContain("subagent 1/9 · s1")
  type(ESC)
  await waitFor(() => !lastFrame().includes("esc close"))
  type(CTRL8)
  await waitFor(() => lastFrame().includes("done from s8"))
  expect(lastFrame()).toContain("subagent 8/9 · s8")
  type(ESC)
  await waitFor(() => !lastFrame().includes("esc close"))
  type(CTRL9)                                                     // 9th child: picker instead of a direct map
  await waitFor(() => lastFrame().includes("choose child"))
  const pf = lastFrame()
  expect(pf).toContain("8 · s8")                                   // windowed like the agent picker…
  expect(pf).not.toContain("9 · s9")                               // …child 9 is past the window
  for (let i = 0; i < 8; i++) type("\x1b[B")                      // down to child 9
  await waitFor(() => lastFrame().includes("9 · s9"))
  type("\r")                                                      // pick it
  await waitFor(() => lastFrame().includes("done from s9"))
  expect(lastFrame()).toContain("subagent 9/9 · s9")
  type(ESC)
  await waitFor(() => !lastFrame().includes("esc close"))
})

test("ctrl+N still works after the turn; /resume rehydrates children from the store", async () => {
  const env = yoloEnv({ agents: [reviewerAgent()] })
  const parent = env.store.createSession("9router", "glm/glm-5.2", env.projectRoot, "build")
  env.store.appendMessage({ id: "u1", sessionId: parent.id, role: "user", content: "earlier question", createdAt: new Date(0).toISOString() })
  const kid = env.store.createSession("9router", "glm/glm-5.2", env.projectRoot, "reviewer", parent.id)
  env.store.appendMessage({ id: "k1", sessionId: kid.id, role: "user", content: "review a.txt", createdAt: new Date(0).toISOString() })
  env.store.appendMessage({ id: "k2", sessionId: kid.id, role: "assistant", content: "child answer from history", createdAt: new Date(0).toISOString() })

  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("/resume\r")
  await waitFor(() => lastFrame().includes("earlier question"))
  type("\r")                                    // pick the parent session
  await waitFor(() => lastFrame().includes(CARET))
  type(CTRL1)                                   // rehydrated from the store, not from live state
  await waitFor(() => lastFrame().includes("child answer from history"))
  expect(lastFrame()).toContain("subagent 1/1 · reviewer")
  type(ESC)
  await waitFor(() => !lastFrame().includes("esc close"))
})

test("ctrl+9 with at most 8 children does not open the picker", async () => {
  const agents = Array.from({ length: 8 }, (_, i) => ({ id: `s${i + 1}`, mode: "subagent", prompt: `You are S${i + 1}.` }))
  let parentRounds = 0
  const provider = {
    chat: async (a: any) => {
      const sys: string = a.messages[0].content
      if (sys.includes("You are S")) return { content: "done", toolCalls: [] }
      parentRounds++
      if (parentRounds === 1) return {
        content: "",
        toolCalls: agents.map((ag, i) => ({ id: `t${i}`, name: "subagent", args: { agent: ag.id, prompt: `task ${i}` } })),
      }
      return { content: "parent done", toolCalls: [] }
    },
  }
  const env = yoloEnv({ tools: [makeSubagentTool()], agents, makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 30))
  type("go\r")
  await waitFor(() => lastFrame().includes(CARET))
  type(CTRL8)                                                   // 8 or fewer: direct map, no picker
  await waitFor(() => lastFrame().includes("done"))
  expect(lastFrame()).toContain("subagent 8/8 · s8")
  type(CTRL9)
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).not.toContain("choose child")
})

test("/model: esc at the provider level closes the picker, no crash", async () => {
  const provider = {
    chat: async () => ({ content: "", toolCalls: [] }),
    listModels: async () => ["m1", "m2"],
  }
  const env = fakeEnv({ makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 40))
  type("/model\r")
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).toContain("choose provider")
  type("\u001b")                                   // esc at the provider level
  await new Promise(r => setTimeout(r, 80))
  const f = lastFrame()
  expect(f).not.toContain("choose provider")       // picker unmounted
  expect(f).toContain(">")                         // composer is back
})

test("/model: models level, esc returns to providers, esc again closes", async () => {
  const provider = {
    chat: async () => ({ content: "", toolCalls: [] }),
    listModels: async () => ["m1", "m2"],
  }
  const env = fakeEnv({ makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 40))
  type("/model\r")
  await new Promise(r => setTimeout(r, 60))
  type("\r")                                       // enter on the current provider
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).toContain("m1")
  type("\u001b")                                   // back to providers
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).toContain("choose provider")
  type("\u001b")                                   // close
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).not.toContain("choose provider")
})

test("/model: esc while the model list is still loading still closes", async () => {
  const provider = {
    chat: async () => ({ content: "", toolCalls: [] }),
    listModels: () => new Promise<string[]>(r => setTimeout(() => r(["m1"]), 150)),
  }
  const env = fakeEnv({ makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 40))
  type("/model\r")
  await new Promise(r => setTimeout(r, 60))
  type("\r")                                       // provider chosen; fetch pending
  await new Promise(r => setTimeout(r, 20))
  expect(lastFrame()).toContain("loading models")
  type("\u001b")                                   // back mid-load
  await new Promise(r => setTimeout(r, 20))
  type("\u001b")                                   // close mid-load
  await new Promise(r => setTimeout(r, 300))       // let the promise settle after unmount
  expect(lastFrame()).not.toContain("choose provider")
  expect(lastFrame()).not.toContain("loading models")
})

test("/model: ctrl+c closes the picker; a following esc types nothing and does not crash", async () => {
  const provider = { chat: async () => ({ content: "", toolCalls: [] }), listModels: async () => ["m1"] }
  const env = fakeEnv({ makeProvider: () => provider })
  const { type, lastFrame } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 40))
  type("/model\r")
  await new Promise(r => setTimeout(r, 60))
  expect(lastFrame()).toContain("choose provider")
  type("\u0003")                                   // ctrl+c closes the overlay
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).not.toContain("choose provider")
  type("\u001b")                                   // dead-handler hazard: must be inert
  await new Promise(r => setTimeout(r, 60))        // separate read: ESC+x in one write
                                                   // parses as alt+x (key.meta), not two keys
  type("x")
  await new Promise(r => setTimeout(r, 80))
  expect(lastFrame()).toContain("x")               // composer alive, caret has the text
})

test("two separate enters persist the choice once", async () => {
  const provider = {
    chat: async () => ({ content: "", toolCalls: [] }),
    listModels: async () => ["m1", "m2"],
  }
  const env = fakeEnv({ makeProvider: () => provider })
  const calls: string[] = []
  const real = env.store.setModel.bind(env.store)
  env.store.setModel = (...a: any[]) => { calls.push(String(a[1])); return real(...a) }
  const { type } = renderTui(<App env={env} />)
  await new Promise(r => setTimeout(r, 40))
  type("/model\r")
  await new Promise(r => setTimeout(r, 60))
  type("\r")                                        // providers → models
  await new Promise(r => setTimeout(r, 80))
  type("\r")                                        // pick — overlay closes here
  await new Promise(r => setTimeout(r, 80))
  type("\r")                                        // stray third Enter
  await new Promise(r => setTimeout(r, 120))
  expect(calls).toEqual(["9router"])                // one setModel, not two
})
