import { test, expect } from "bun:test"
import { renderTui } from "./harness"
import { McpList } from "./mcp-list"
import type { McpServerState } from "../../core/mcp/manager"

const states: McpServerState[] = [
  { name: "echo", type: "local", status: "connected", toolCount: 1 },
  { name: "tf", type: "remote", status: "failed", error: "boom", toolCount: 0 },
  { name: "off", type: "remote", status: "disabled", toolCount: 0 },
]
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))
const noop = { onAction: async () => {}, onClose: () => {} }

test("lists every server with its status", async () => {
  const { lastFrame } = renderTui(<McpList states={states} {...noop} />)
  await wait()
  const f = lastFrame()
  expect(f).toContain("echo (local) — connected, 1 tool")
  expect(f).toContain("tf (remote) — failed: boom")
  expect(f).toContain("off (remote) — disabled")
})

test("empty list renders the hint", async () => {
  const { lastFrame } = renderTui(<McpList states={[]} {...noop} />)
  await wait()
  expect(lastFrame()).toContain("no MCP servers")
})

test("enter on a failed server offers reconnect and disable", async () => {
  const { type, lastFrame } = renderTui(<McpList states={states} {...noop} />)
  await wait()
  type("\u001b[B")   // move to "tf"
  await wait()
  type("\r")
  await wait()
  const f = lastFrame()
  expect(f).toContain("reconnect")
  expect(f).toContain("disable")
})

test("choosing reconnect calls onAction with the server name", async () => {
  const calls: string[] = []
  const { type } = renderTui(<McpList states={states} onAction={async (n, a) => { calls.push(`${n}:${a}`) }} onClose={() => {}} />)
  await wait()
  type("\u001b[B")
  await wait()
  type("\r")          // open the actions
  await wait()
  type("\r")          // pick the first action (reconnect)
  await wait(60)
  expect(calls).toEqual(["tf:reconnect"])
})

test("escape closes", async () => {
  let closed = 0
  const { type } = renderTui(<McpList states={states} onAction={async () => {}} onClose={() => { closed++ }} />)
  await wait()
  type("\u001b")
  await wait(60)
  expect(closed).toBe(1)
})

test("an auth_required server offers authenticate and shows the consent URL while waiting", async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  const calls: string[] = []
  const authStates: McpServerState[] = [{ name: "tf", type: "remote", status: "auth_required", toolCount: 0 }]
  const { type, lastFrame } = renderTui(
    <McpList
      states={authStates}
      onAction={async (n, a, onUrl) => { calls.push(`${n}:${a}`); onUrl("https://as.example/authorize?x=1"); await gate }}
      onClose={() => {}}
    />,
  )
  await wait()
  expect(lastFrame()).toContain("tf (remote) — auth_required: needs authentication")
  type("\r")           // open the actions
  await wait()
  expect(lastFrame()).toContain("authenticate")
  type("\r")           // pick authenticate
  await wait(60)
  expect(calls).toEqual(["tf:authenticate"])
  expect(lastFrame()).toContain("waiting for authorization")
  expect(lastFrame()).toContain("https://as.example/authorize?x=1")
  release()
  await wait(60)
})
