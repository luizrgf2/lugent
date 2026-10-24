// Minimal MCP server over stdio for tests.
// - `tools/call` text "__hang__" never answers (client timeout path)
// - `tools/call` text "__boom__" returns an isError result
// - `tools/call` text "__exit__" exits the process (unexpected-death path)
// - MCP_FIXTURE_HANG=initialize never answers the handshake (a server that
//   starts fine and then stalls — the dangerous case for startup isolation)
// - MCP_FIXTURE_PIDFILE=<path> records the pid so a test can assert the child
//   is really gone after closeSync
import { writeFileSync } from "node:fs"

const dec = new TextDecoder()
const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n")
// A test may close our stdout while we are still writing (oversized-payload
// case): swallow the broken pipe instead of dumping an unhandled EPIPE.
process.stdout.on("error", () => {})
let buf = ""

const pidFile = process.env.MCP_FIXTURE_PIDFILE
if (pidFile) writeFileSync(pidFile, String(process.pid))

process.stdin.on("data", (c: Uint8Array) => {
  buf += dec.decode(c)
  let i: number
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    const msg = JSON.parse(line)
    if (msg.method === "initialize") {
      if (process.env.MCP_FIXTURE_HANG === "initialize") continue
      send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1" } } })
    } else if (msg.method === "notifications/initialized") {
      // notification: no reply
    } else if (msg.method === "tools/list") {
      send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
        { name: "echo", description: "Echo the input", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
      ] } })
    } else if (msg.method === "tools/call") {
      const text = msg.params?.arguments?.text
      if (text === "__hang__") continue
      if (text === "__exit__") process.exit(3)
      if (text === "__boom__") {
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "kaboom" }], isError: true } })
        continue
      }
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `echo: ${text}` }] } })
    } else if (msg.method === "test/stderr") {
      process.stderr.write("fixture stderr line\n")
      send({ jsonrpc: "2.0", id: msg.id, result: {} })
    } else if (msg.method === "test/flood") {
      process.stdout.write("x".repeat(9 * 1024 * 1024))   // no newline: oversized partial line, no reply
    } else if (msg.id !== undefined) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } })
    }
  }
})
process.stdin.on("end", () => process.exit(0))
