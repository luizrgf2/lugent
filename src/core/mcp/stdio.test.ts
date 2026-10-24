import { test, expect } from "bun:test"
import { join } from "node:path"
import { StdioTransport } from "./stdio"
import type { JsonRpcMessage } from "./protocol"

const fixture = join(import.meta.dir, "__fixtures__", "mcp-echo-server.ts")

function collect() {
  const msgs: JsonRpcMessage[] = []
  let closed = false
  const errors: Error[] = []
  return { msgs, errors, isClosed: () => closed, handlers: {
    onMessage: (m: JsonRpcMessage) => msgs.push(m),
    onError: (e: Error) => errors.push(e),
    onClose: () => { closed = true },
  } }
}

test("stdio: sends a request and receives the reply", async () => {
  const t = new StdioTransport(["bun", fixture], { cwd: process.cwd() })
  const c = collect()
  await t.start(c.handlers)
  await t.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lugent", version: "0.1.0" } } })
  const deadline = Date.now() + 5000
  while (c.msgs.length === 0 && Date.now() < deadline) await Bun.sleep(20)
  expect((c.msgs[0] as any).result.serverInfo.name).toBe("echo")
  await t.close()
})

test("stdio: close ends the child and fires onClose", async () => {
  const t = new StdioTransport(["bun", fixture], { cwd: process.cwd() })
  const c = collect()
  await t.start(c.handlers)
  await t.close()
  const deadline = Date.now() + 5000
  while (!c.isClosed() && Date.now() < deadline) await Bun.sleep(20)
  expect(c.isClosed()).toBe(true)
})

test("stdio: bad command rejects start", async () => {
  const t = new StdioTransport(["/definitely/not/a/binary"], { cwd: process.cwd() })
  const c = collect()
  await expect(t.start(c.handlers)).rejects.toThrow()
})
