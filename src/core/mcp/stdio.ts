import type { JsonRpcMessage } from "./protocol"
import type { Transport, TransportHandlers } from "./transport"
import { LineBuffer } from "./framing"

type Child = Bun.Subprocess<"pipe", "pipe", "pipe">

/** Spawns an MCP server and speaks newline-delimited JSON-RPC over its stdio. */
export class StdioTransport implements Transport {
  private proc?: Child
  private handlers?: TransportHandlers
  private buf = new LineBuffer()

  constructor(private command: string[], private opts: { cwd: string; env?: Record<string, string> }) {}

  async start(handlers: TransportHandlers): Promise<void> {
    this.handlers = handlers
    let proc: Child
    try {
      proc = Bun.spawn(this.command, {
        cwd: this.opts.cwd,
        env: { ...process.env, ...this.opts.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch (e: any) {
      throw new Error(`failed to spawn ${this.command[0]}: ${e?.message ?? e}`)
    }
    this.proc = proc
    void this.readStdout(proc)
    void this.readStderr(proc)
    proc.exited.then(() => {
      if (this.proc === proc) this.proc = undefined
      handlers.onClose()
    })
  }

  private async readStdout(proc: Child): Promise<void> {
    const dec = new TextDecoder()
    try {
      for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
        for (const msg of this.buf.push(dec.decode(chunk, { stream: true }))) this.handlers?.onMessage(msg)
        if (this.buf.overflowed) {
          this.handlers?.onError(new Error(`server sent more than ${this.buf.maxBytes} bytes with no message boundary — dropping the stream`))
          return
        }
      }
    } catch (e: any) {
      this.handlers?.onError(e instanceof Error ? e : new Error(String(e)))
    }
  }

  private async readStderr(proc: Child): Promise<void> {
    // must be drained or a chatty server can block on a full pipe
    const dec = new TextDecoder()
    try {
      for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
        const text = dec.decode(chunk, { stream: true })
        if (text.trim()) console.warn(`mcp stderr: ${text.trim()}`)
      }
    } catch { /* ignore */ }
  }

  async send(msg: JsonRpcMessage): Promise<void> {
    if (!this.proc) throw new Error("transport not started")
    this.proc.stdin.write(JSON.stringify(msg) + "\n")
    await this.proc.stdin.flush()
  }

  async close(): Promise<void> {
    const proc = this.proc
    if (!proc) return
    this.proc = undefined
    try { proc.stdin.end() } catch { /* already closed */ }
    const term = setTimeout(() => { try { proc.kill("SIGTERM") } catch { /* gone */ } }, 500)
    const kill = setTimeout(() => { try { proc.kill("SIGKILL") } catch { /* gone */ } }, 1000)
    try { await proc.exited } finally { clearTimeout(term); clearTimeout(kill) }
  }

  closeSync(): void {
    const proc = this.proc
    if (!proc) return
    this.proc = undefined
    try { proc.stdin.end() } catch { /* already closed */ }
    try { proc.kill("SIGKILL") } catch { /* gone */ }
  }
}
