import { describe, test, expect } from "bun:test"
import { buildPrefix, buildMessages } from "./prompt"
import type { Message } from "./types"

const input = {
  cwd: "/home/u/proj", os: "linux", gitBranch: "main", date: "2026-10-22",
  agentsMd: "# Rules\n- run tests", skills: [
    { id: "git-release", name: "Git Release", description: "Prepare releases", file: "/x" },
  ],
  tools: [
    { name: "read", description: "Read a file", schema: { type: "object" } },
  ],
}

test("golden: prefix is byte-stable across calls and frozen", () => {
  const a = buildPrefix(input)
  const b = buildPrefix(input)
  expect(a).toBe(b)
  expect(a).toMatchSnapshot()
})

test("prefix contains every section in order", () => {
  const p = buildPrefix(input)
  const sys = p.indexOf("You are lugent")
  const env = p.indexOf("Environment:")
  const agents = p.indexOf("# Rules")
  const skills = p.indexOf("git-release")
  const tools = p.indexOf("- read:")
  expect(sys).toBeGreaterThanOrEqual(0)
  expect(sys).toBeLessThan(env)
  expect(env).toBeLessThan(agents)
  expect(agents).toBeLessThan(skills)
  expect(skills).toBeLessThan(tools)
})

test("null AGENTS.md skips section without blank residue", () => {
  const p = buildPrefix({ ...input, agentsMd: null })
  expect(p).not.toContain("# Rules")
  expect(p).not.toContain("AGENTS.md")
})

test("buildMessages maps history roles to wire format", () => {
  const history: Message[] = [
    { id: "1", sessionId: "s", role: "user", content: "hi", createdAt: "2026-01-01T00:00:00Z" },
    { id: "2", sessionId: "s", role: "assistant", content: null,
      toolCalls: [{ id: "tc1", name: "read", args: { path: "a" } }], createdAt: "2026-01-01T00:00:01Z" },
    { id: "3", sessionId: "s", role: "tool", content: "file text", toolCallId: "tc1", createdAt: "2026-01-01T00:00:02Z" },
  ]
  const msgs = buildMessages("PREFIX", history)
  expect(msgs[0]).toEqual({ role: "system", content: "PREFIX" })
  expect(msgs[1]).toEqual({ role: "user", content: "hi" })
  expect(msgs[2].role).toBe("assistant")
  expect(msgs[2].tool_calls).toEqual([{ id: "tc1", type: "function", function: { name: "read", arguments: "{\"path\":\"a\"}" } }])
  expect(msgs[3]).toEqual({ role: "tool", tool_call_id: "tc1", content: "file text" })
})
