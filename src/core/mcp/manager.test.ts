import { test, expect } from "bun:test"
import { join } from "node:path"
import { readFileSync, rmSync, existsSync } from "node:fs"
import { McpManager } from "./manager"
import type { McpServerConfigMap } from "../config"

const fixture = join(import.meta.dir, "__fixtures__", "mcp-echo-server.ts")
const local = (): McpServerConfigMap[string] => ({ type: "local", command: ["bun", fixture] })

const isAlive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const waitGone = async (pid: number, ms = 3000) => {
  const t0 = Date.now()
  while (isAlive(pid) && Date.now() - t0 < ms) await Bun.sleep(20)
  return !isAlive(pid)
}
const pidFile = (tag: string) => `/tmp/opencode/mcp-pid-${tag}-${Date.now()}-${process.pid}`

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

test("a server that spawns and then stalls its handshake does not hold up the others", async () => {
  const m = new McpManager({
    good: local(),
    hang: { type: "local", command: ["bun", fixture], environment: { MCP_FIXTURE_HANG: "initialize" }, timeout: 200 },
  }, process.cwd())
  await m.connectAll()
  const states = m.states()
  expect(states.find(s => s.name === "good")!.status).toBe("connected")
  const hang = states.find(s => s.name === "hang")!
  expect(hang.status).toBe("failed")
  expect(hang.error).toMatch(/timed out/)
  expect(m.tools().map(t => t.name)).toEqual(["good_echo"])   // the hung server contributes nothing
  m.closeSync()
})

test("a child that dies flips its server to failed and drops its tools", async () => {
  const m = new McpManager({ echo: local() }, process.cwd())
  await m.connectAll()
  expect(m.states()[0].status).toBe("connected")
  await expect(m.tools()[0].execute({ text: "__exit__" }, { cwd: process.cwd() }))
    .rejects.toThrow(/closed the connection/)
  const t0 = Date.now()
  while (m.states()[0].status !== "failed" && Date.now() - t0 < 3000) await Bun.sleep(10)
  const s = m.states()[0]
  expect(s.status).toBe("failed")
  expect(s.error).toMatch(/closed the connection/)
  expect(m.tools()).toEqual([])                  // a dead server stops advertising tools
  await m.reconnect("echo")                      // and /mcp can bring it back
  expect(m.states()[0].status).toBe("connected")
  m.closeSync()
})

test("closeSync kills a live child", async () => {
  const pidf = pidFile("live")
  const m = new McpManager({ echo: { type: "local", command: ["bun", fixture], environment: { MCP_FIXTURE_PIDFILE: pidf } } }, process.cwd())
  await m.connectAll()
  const pid = parseInt(readFileSync(pidf, "utf8"), 10)
  expect(isAlive(pid)).toBe(true)
  m.closeSync()
  expect(await waitGone(pid)).toBe(true)
  rmSync(pidf, { force: true })
})

test("closeSync reaches a client whose handshake is still in flight", async () => {
  const pidf = pidFile("inflight")
  const m = new McpManager({
    hang: { type: "local", command: ["bun", fixture], environment: { MCP_FIXTURE_HANG: "initialize", MCP_FIXTURE_PIDFILE: pidf }, timeout: 10_000 },
  }, process.cwd())
  const connecting = m.connectAll()               // not awaited: the handshake never answers
  const t0 = Date.now()
  while (!existsSync(pidf) && Date.now() - t0 < 5000) await Bun.sleep(10)
  expect(existsSync(pidf)).toBe(true)
  const pid = parseInt(readFileSync(pidf, "utf8"), 10)
  m.closeSync()                                   // must reach the un-attached client
  expect(await waitGone(pid)).toBe(true)
  await connecting                                // resolves: the hung request rejects on close
  expect(m.states()[0].status).toBe("failed")
  rmSync(pidf, { force: true })
})

test("enable on a connected server does not reconnect it", async () => {
  const pidf = pidFile("noreconnect")
  const m = new McpManager({ echo: { type: "local", command: ["bun", fixture], environment: { MCP_FIXTURE_PIDFILE: pidf } } }, process.cwd())
  await m.connectAll()
  const pid = parseInt(readFileSync(pidf, "utf8"), 10)
  await m.enable("echo")
  expect(m.states()[0].status).toBe("connected")
  expect(parseInt(readFileSync(pidf, "utf8"), 10)).toBe(pid)   // same child: no reconnect
  m.closeSync()
  rmSync(pidf, { force: true })
})

test("a remote server that answers 401 fails closed with a clear message", async () => {
  const srv = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="https://x"' } }) })
  try {
    const m = new McpManager({ tf: { type: "remote", url: `http://127.0.0.1:${srv.port}/mcp` } }, process.cwd())
    await m.connectAll()
    const s = m.states()[0]
    expect(s.status).toBe("failed")
    expect(s.error).toMatch(/OAuth/)
    expect(m.tools()).toEqual([])
    m.closeSync()
  } finally { srv.stop(true) }
})
