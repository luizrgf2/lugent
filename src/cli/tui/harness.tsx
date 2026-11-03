export function renderTui(tree: unknown, opts: { rows?: number } = {}) {
  const events: { type: string; data: any }[] = []
  const frames: string[] = []
  const stdout: any = new EventEmitter()
  Object.assign(stdout, {
    columns: 100, rows: opts.rows ?? 30, isTTY: true,
    write(s: string, cb?: (err?: Error | null) => void) {
      // Terminal mode toggles (bracketed paste on/off) are not UI frames —
      // recording them makes lastFrame() the mode switch instead of content.
      if (!/^\x1b\[\?2004[hl]$/.test(s)) frames.push(s)
      cb?.(null); return true
    },
  })
  const stdin: any = new EventEmitter()
  const pending: string[] = []
  stdin.write = (s: string) => { pending.push(s) }
  stdin.setRawMode = () => {}
  stdin.resume = () => {}
  stdin.pause = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  stdin.isTTY = true

  const instance = render(tree as any, { stdout: stdout as any, stdin: stdin as any, debug: true })

  return {
    instance,
    frames,
    lastFrame: () => frames.at(-1) ?? "",
    allOutput: () => frames.join(""),
    type(s: string) {
      for (const ch of s) {
        stdin.emit("data", Buffer.from(ch))
        stdin.emit("keypress", ch, undefined)
      }
    },
    unmount() { instance.unmount() },
  }
}
