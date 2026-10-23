import { EventEmitter } from "node:events"
import { render } from "ink"

const stripAnsi = (s: string): string =>
  s.replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1B\][^\x07]*\x07/g, "")

/**
 * Dev-only test harness rendering through ink's real renderer
 * (ink-testing-library targets ink ^5 and misbehaves on v8).
 */
export function renderTui(tree: unknown) {
  const frames: string[] = []
  const stdout: any = new EventEmitter()
  Object.assign(stdout, {
    columns: 100, rows: 30, isTTY: true,
    write(s: string) { frames.push(s); return true },
  })
  const stdin: any = new EventEmitter()
  const pending: string[] = []
  Object.assign(stdin, {
    isTTY: true, isRaw: true,
    setRawMode() { return stdin }, setEncoding() { return stdin },
    ref() {}, unref() {}, pause() {}, resume() {},
    read() { return pending.shift() ?? null },
  })
  const inst = render(tree as any, { stdout, stdin, stderr: stdout, exitOnCtrlC: false, debug: true })
  return {
    unmount: () => inst.unmount(),
    /** Type one key per write — mirrors raw-mode terminals (1 key per read). */
    type(s: string) {
      for (const ch of s) { pending.push(ch); stdin.emit("readable") }
    },
    lastFrame(): string { return frames.length ? stripAnsi(frames[frames.length - 1]) : "" },
  }
}
