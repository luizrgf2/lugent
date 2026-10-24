import { test, expect } from "bun:test"
import { join } from "node:path"
import { McpManager } from "./manager"
import type { McpServerConfigMap } from "../config"

const fixture = join(import.meta.dir, "__fixtures__", "mcp-echo-server.ts")
const local = (): McpServerConfigMap[string] => ({ type: "local", command: ["bun", fixture] })

test("connectAll exposes tools and reports connected state", async () => {
  const m = new McpManager({ echo: local() }, process.cwd())
  await m.connectAll()
  expect(m.tools().map(t => t.name)).toEqual(["echo_echo"])
  expect(m.states()).toEqual([{ name: "echo", type: "local", status: "connected", toolCount: 1 }])
  m.closeSync()
})

test("one bad server does not sink the others", async () => {
  const m = new McpManager({ good: local(), bad: { type: "local", command: ["/definitely/not/a/binary"] } }, process.cwd())
  await m.connectAll()
  expect(m.tools().map(t => t.name)).toEqual(["good_echo"])
  const bad = m.states().find(s => s.name === "bad")!
  expect(bad.status).toBe("failed")
  expect(bad.error).toBeTruthy()
  expect(bad.toolCount).toBe(0)
  m.closeSync()
})

test("an enabled:false server starts disabled and never connects", async () => {
  const m = new McpManager({ off: { ...local(), enabled: false } }, process.cwd())
  await m.connectAll()
  expect(m.states()[0].status).toBe("disabled")
  expect(m.tools()).toEqual([])
  m.closeSync()
})

test("disable drops the tools; enable brings them back", async () => {
  const m = new McpManager({ echo: local() }, process.cwd())
  await m.connectAll()
  await m.disable("echo")
  expect(m.tools()).toEqual([])
  expect(m.states()[0].status).toBe("disabled")
  await m.enable("echo")
  expect(m.tools().map(t => t.name)).toEqual(["echo_echo"])
  expect(m.states()[0].status).toBe("connected")
  m.closeSync()
})

test("reconnect retries a failed server without throwing", async () => {
  const m = new McpManager({ missing: { type: "local", command: ["/definitely/not/a/binary"] } }, process.cwd())
  await m.connectAll()
  expect(m.states()[0].status).toBe("failed")
  await m.reconnect("missing")
  expect(m.states()[0].status).toBe("failed")
  m.closeSync()
})

test("onChange fires with the active toolset", async () => {
  const m = new McpManager({ echo: local() }, process.cwd())
  const seen: string[][] = []
  m.onChange = t => seen.push(t.map(x => x.name))
  await m.connectAll()
  await m.disable("echo")
  expect(seen).toEqual([["echo_echo"], []])
  m.closeSync()
})

test("an empty config loads nothing", async () => {
  const m = new McpManager({}, process.cwd())
  await m.connectAll()
  expect(m.tools()).toEqual([])
  expect(m.states()).toEqual([])
  m.closeSync()
})
