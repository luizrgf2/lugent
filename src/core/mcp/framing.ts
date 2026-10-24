import type { JsonRpcMessage } from "./protocol"

/**
 * Turns arbitrary text chunks into whole newline-delimited JSON-RPC messages.
 * The buffer is capped: a server that streams a huge payload with no newline
 * must not grow lugent's heap without bound. On overflow the partial line is
 * dropped and `overflowed` is set, so the transport can surface the error.
 */
export class LineBuffer {
  private buf = ""
  overflowed = false
  readonly maxBytes: number

  constructor(maxBytes = 8 * 1024 * 1024) { this.maxBytes = maxBytes }

  push(chunk: string): JsonRpcMessage[] {
    if (this.overflowed) return []   // framing integrity is lost for good
    this.buf += chunk
    if (this.buf.length > this.maxBytes) {
      this.buf = ""
      this.overflowed = true
      return []
    }
    const out: JsonRpcMessage[] = []
    let i: number
    while ((i = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, i).replace(/\r$/, "")
      this.buf = this.buf.slice(i + 1)
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg && typeof msg === "object") out.push(msg as JsonRpcMessage)
      } catch { /* malformed line — skip, keep the stream alive */ }
    }
    return out
  }
}
