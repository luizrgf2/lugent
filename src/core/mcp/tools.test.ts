import { test, expect } from "bun:test"
import { join } from "node:path"
import { StdioTransport } from "./stdio"
import { McpClient } from "./client"
import { mcpToolDefs, sanitizeToolName } from "./tools"

const fixture = join(import.meta.dir, "__fixtures__", "mcp-echo-server.ts")

test("sanitizeToolName keeps provider-safe characters and caps at 64", () => {
  expect(sanitizeToolName("my server/weird.name")).toBe("my_server_weird_name")
  expect(sanitizeToolName("a".repeat(80)).length).toBe(64)
})

test("mcpToolDefs maps a tool to an ask-permission ToolDef with raw schema", async () => {
  const client = new McpClient("echo", new StdioTransport(["bun", fixture], { cwd: process.cwd() }))
  await client.connect()
  const infos = await client.listTools()
  const { tools } = mcpToolDefs("echo", client, infos)

  expect(tools.map(t => t.name)).toEqual(["echo_echo"])
  expect(tools[0].permission).toBe("ask")
  expect((tools[0].schema as any).required).toEqual(["text"])

  const ok = await tools[0].execute({ text: "hi" }, { cwd: process.cwd() })
  expect(ok).toEqual({ output: "echo: hi", error: false })
  const bad = await tools[0].execute({ text: "__boom__" }, { cwd: process.cwd() })
  expect(bad.error).toBe(true)
  await client.close()
})

test("mcpToolDefs drops a colliding name instead of the whole server", async () => {
  const client = new McpClient("echo", new StdioTransport(["bun", fixture], { cwd: process.cwd() }))
  await client.connect()
  const infos = await client.listTools()
  const taken = new Set<string>()
  const first = mcpToolDefs("echo", client, infos, taken)
  const second = mcpToolDefs("echo", client, infos, taken)
  expect(first.tools.length).toBe(1)
  expect(second.tools.length).toBe(0)
  expect(second.skipped).toEqual(["echo_echo"])
  await client.close()
})
