import type { JsonRpcMessage } from "./protocol"

/** Turns arbitrary text chunks into whole newline-delimited JSON-RPC messages. */
export class LineBuffer {
  private buf = ""

  push(chunk: string): JsonRpcMessage[] {
    this.buf += chunk
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
