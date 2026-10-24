// Minimal MCP server over stdio for tests. `tools/call` with text "__hang__"
// never answers, so the client timeout path can be tested.
const dec = new TextDecoder()
const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n")
let buf = ""

process.stdin.on("data", (c: Uint8Array) => {
  buf += dec.decode(c)
  let i: number
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    const msg = JSON.parse(line)
    if (msg.method === "initialize") {
      send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1" } } })
    } else if (msg.method === "notifications/initialized") {
      // notification: no reply
    } else if (msg.method === "tools/list") {
      send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
        { name: "echo", description: "Echo the input", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
      ] } })
    } else if (msg.method === "tools/call") {
      if (msg.params?.arguments?.text === "__hang__") continue
      if (msg.params?.arguments?.text === "__boom__") {
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "kaboom" }], isError: true } })
        continue
      }
      send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `echo: ${msg.params?.arguments?.text}` }] } })
    } else if (msg.method === "test/stderr") {
      process.stderr.write("fixture stderr line\n")
      send({ jsonrpc: "2.0", id: msg.id, result: {} })
    } else if (msg.id !== undefined) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } })
    }
  }
})
process.stdin.on("end", () => process.exit(0))
