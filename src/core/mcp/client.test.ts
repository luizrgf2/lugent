import { test, expect } from "bun:test"
import { join } from "node:path"
import { StdioTransport } from "./stdio"
import { McpClient } from "./client"

const fixture = join(import.meta.dir, "__fixtures__", "mcp-echo-server.ts")
const connect = (timeout?: number) =>
  new McpClient("echo", new StdioTransport(["bun", fixture], { cwd: process.cwd() }), timeout)

test("connect negotiates the protocol and reports server info", async () => {
  const c = connect()
  const info = await c.connect()
  expect(info.protocolVersion).toBe("2025-06-18")
  expect((info.serverInfo as any).name).toBe("echo")
  await c.close()
})

test("listTools returns name, description and raw inputSchema", async () => {
  const c = connect()
  await c.connect()
  const tools = await c.listTools()
  expect(tools.map(t => t.name)).toEqual(["echo"])
  expect((tools[0].inputSchema as any).required).toEqual(["text"])
  await c.close()
})

test("callTool joins text parts and maps isError", async () => {
  const c = connect()
  await c.connect()
  expect(await c.callTool("echo", { text: "hi" })).toEqual({ output: "echo: hi", error: false })
  expect(await c.callTool("echo", { text: "__boom__" })).toEqual({ output: "kaboom", error: true })
  await c.close()
})

test("a hanging request rejects on its own timeout", async () => {
  const c = connect(120)
  await c.connect()
  await expect(c.callTool("echo", { text: "__hang__" })).rejects.toThrow(/timed out/)
  await c.close()
})

test("calls after close fail fast", async () => {
  const c = connect()
  await c.connect()
  await c.close()
  await expect(c.callTool("echo", { text: "x" })).rejects.toThrow(/not connected/)
})

test("a server that dies rejects the in-flight call and fails later ones fast", async () => {
  const c = connect()
  await c.connect()
  await expect(c.callTool("echo", { text: "__exit__" })).rejects.toThrow(/closed the connection/)
  await expect(c.callTool("echo", { text: "x" })).rejects.toThrow(/not connected/)
})

test("onClosed fires once when the server dies on its own", async () => {
  const c = connect()
  const errs: string[] = []
  c.onClosed = e => errs.push(e.message)
  await c.connect()
  await c.callTool("echo", { text: "__exit__" }).catch(() => {})
  expect(errs.length).toBe(1)
  expect(errs[0]).toMatch(/closed the connection/)
})

test("an intentional close is not reported as a crash", async () => {
  const c = connect()
  const errs: string[] = []
  c.onClosed = e => errs.push(e.message)
  await c.connect()
  await c.close()
  await Bun.sleep(50)   // let the child's exit settle; a crash report would land here
  expect(errs).toEqual([])
})

test("a json-rpc error rejects with the server message", async () => {
  const c = connect()
  await c.connect()
  await expect(c.requestForTest("nope/nope")).rejects.toThrow(/method not found/)
  await c.close()
})
