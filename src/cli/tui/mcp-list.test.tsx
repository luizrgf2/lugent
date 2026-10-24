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

test("the consent URL stays on one logical line, outside the box border", async () => {
  // Regression: a long URL used to wrap inside the bordered box, so every visual
  // line got a `│` and a hard newline — copy-paste produced an unusable URL.
  const url =
    "https://chatback.takeflow.com.br/oauth/authorize?response_type=code&client_id=tfmcp_68e2dd9d32a902e8d7892f10e9c85681&redirect_uri=http%3A%2F%2F127.0.0.1%3A48762%2Foauth%2Fcallback&state=25afa61b2440989360120fc4f146e10744ffab2c47bbedfe01e468e3bba1de83&code_challenge=mZ-0CFdcdGfcj2v1bKamkZrZDgOjlkeA0vTk03XiZ6E&code_challenge_method=S256&resource=https%3A%2F%2Fchatback.takeflow.com.br%2Fmcp"
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  const authStates: McpServerState[] = [{ name: "tf", type: "remote", status: "auth_required", toolCount: 0 }]
  const { type, lastFrame } = renderTui(
    <McpList
      states={authStates}
      onAction={async (_n, _a, onUrl) => { onUrl(url); await gate }}
      onClose={() => {}}
    />,
  )
  await wait()
  type("\r")
  await wait()
  type("\r")
  await wait(60)
  const lines = lastFrame().split("\n")
  const urlLine = lines.find(l => l.includes("authorize"))
  expect(urlLine).toBeDefined()
  expect(urlLine).toContain(url)       // whole URL on one logical line: no hard wrap
  expect(urlLine).not.toContain("│")   // and no box border mixed into it
  release()
  await wait(60)
})
