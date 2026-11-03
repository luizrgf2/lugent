import { test, expect } from "bun:test"
import { buildPromptInput } from "./context"
import type { ToolDef } from "../core/tools/registry"

const readTool: ToolDef = {
  name: "read", description: "Read a file", schema: { type: "object", properties: {} },
  permission: "allow", execute: async () => ({ output: "" }),
}
const shellTool: ToolDef = {
  name: "shell", description: "Run a command", schema: { type: "object", properties: {} },
  permission: "ask", execute: async () => ({ output: "" }),
}

const env = { projectRoot: "/tmp/opencode", skills: [], tools: [readTool, shellTool] } as any

test("the agent's toolset filter also applies to the # Tools section", () => {
  const p = buildPromptInput(env, "m", { id: "r", prompt: "p", tools: ["read"] })
  expect(p.tools.map(t => t.name)).toEqual(["read"])
})

test("no agent keeps every tool in the prompt", () => {
  expect(buildPromptInput(env, "m").tools.map(t => t.name)).toEqual(["read", "shell"])
})

test("an agent that cannot use the skill tool gets no skills advertisement", () => {
  const withSkill = { ...env, skills: [{ id: "rel", name: "Rel", description: "Releases", file: "/x" }] }
  const p = buildPromptInput(withSkill, "m", { id: "r", prompt: "p", tools: ["read"] })
  expect(p.skills).toEqual([])
})

test("no agent keeps the skills advertisement", () => {
  const withSkill = { ...env, skills: [{ id: "rel", name: "Rel", description: "Releases", file: "/x" }] }
  expect(buildPromptInput(withSkill, "m").skills.length).toBe(1)
})

const subagentTool: ToolDef = {
  name: "subagent", description: "Launch a subagent", schema: { type: "object", properties: {} },
  permission: "ask", execute: async () => ({ output: "" }),
}

test("the subagent catalog is advertised when the subagent tool is in the toolset", () => {
  const withSub = {
    ...env,
    tools: [readTool, shellTool, subagentTool],
    agents: [
      { id: "build", prompt: "b" },
      { id: "reviewer", prompt: "r", mode: "subagent", description: "Reviews" },
    ],
  }
  expect(buildPromptInput(withSub, "m").subagents).toEqual([{ id: "reviewer", description: "Reviews" }])
})

test("no catalog when the agent withholds the subagent tool", () => {
  const noTool = { ...env, agents: [{ id: "reviewer", prompt: "r", mode: "subagent", description: "Reviews" }] }
  expect(buildPromptInput(noTool, "m").subagents).toEqual([])
})
