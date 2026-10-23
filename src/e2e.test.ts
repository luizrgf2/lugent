import { test, expect, beforeAll, afterAll } from "bun:test"
import { runTurn } from "./core/loop"
import { Store } from "./core/store"
import { makeTools } from "./core/tools"
import { loadSkills } from "./core/skills"
import { loadAgents, toolsForAgent } from "./core/agents"
import { rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"

const ROOT = "/tmp/opencode/e2e"
const DB = "/tmp/opencode/e2e.db"

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
  rmSync(DB, { force: true })
  mkdirSync(`${ROOT}/.agents/skills/rel`, { recursive: true })
  writeFileSync(`${ROOT}/.agents/skills/rel/SKILL.md`, `---\nname: Rel\ndescription: Releases\n---\nTag it.`)
  writeFileSync(`${ROOT}/AGENTS.md`, "# Rules\n- always run tests")
  writeFileSync(`${ROOT}/src.txt`, "42\n")
  mkdirSync(`${ROOT}/.agents/agents`, { recursive: true })
  writeFileSync(`${ROOT}/.agents/agents/reviewer.md`,
    `---\ndescription: Reviews read-only\nmodel: fake/fake-model\ntools: [read, glob]\n---\nYou are a reviewer. Do not edit files.`)
})
afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
  rmSync(DB, { force: true })
})

test("e2e: one turn with a tool call, then final answer", async () => {
  const store = new Store(DB)
  const session = store.createSession("fake", "fake-model")
  const skills = loadSkills(ROOT)
  const tools = makeTools(ROOT)
  const seenPrefixes: string[] = []

  let step = 0
  const provider = {
    chat: async (a: any) => {
      seenPrefixes.push(a.messages[0].content)
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "read", args: { path: "src.txt" } }] }
      return { content: "the answer is 42", toolCalls: [] }
    },
  }

  const r = await runTurn({
    store,
    provider,
    tools,
    signal: new AbortController().signal,
    onAsk: async () => "y" as const,
    promptInput: {
      cwd: ROOT, os: "linux", gitBranch: null, date: "2026-10-22",
      agentsMd: "# Rules\n- always run tests",
      skills, tools: tools.map(t => ({ name: t.name, description: t.description, schema: t.schema })),
    },
  }, session.id, "what is in src.txt")

  expect(r.aborted).toBe(false)
  const msgs = store.getMessages(session.id)
  expect(msgs.map(m => m.role)).toEqual(["user", "assistant", "tool", "assistant"])
  expect(msgs[3].content).toBe("the answer is 42")
  // prefix stability across the two iterations
  expect(seenPrefixes[0]).toBe(seenPrefixes[1])
  // prefix carries AGENTS.md and the skill list
  expect(seenPrefixes[0]).toContain("always run tests")
  expect(seenPrefixes[0]).toContain("rel: Rel")
  store.close()
})

test("e2e: agent turn uses its prompt, filters the toolset, keeps the prefix stable", async () => {
  const store = new Store(DB)
  const session = store.createSession("fake", "fake-model", ROOT, "reviewer")
  const tools = makeTools(ROOT)
  const agent = loadAgents(ROOT).find(a => a.id === "reviewer")
  expect(agent?.id).toBe("reviewer")

  const seenPrefixes: string[] = []
  const seenTools: string[][] = []
  let step = 0
  const provider = {
    chat: async (a: any) => {
      seenPrefixes.push(a.messages[0].content)
      seenTools.push(a.tools.map((t: any) => t.name))
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "read", args: { path: "src.txt" } }] }
      return { content: "reviewed", toolCalls: [] }
    },
  }

  const r = await runTurn({
    store, provider, tools, agent,
    signal: new AbortController().signal,
    onAsk: async () => "y" as const,
    promptInput: {
      cwd: ROOT, os: "linux", gitBranch: null, date: "2026-10-22",
      agentsMd: "# Rules\n- always run tests",
      skills: [],
      tools: toolsForAgent(tools, agent).map(t => ({ name: t.name, description: t.description, schema: t.schema })),
      agentPrompt: agent!.prompt,
    },
  }, session.id, "review src.txt")

  expect(r.aborted).toBe(false)
  expect(seenPrefixes[0]).toContain("You are a reviewer")
  expect(seenPrefixes[0]).not.toContain("You are lugent")
  expect(seenPrefixes[0]).toContain("always run tests")   // AGENTS.md still on top
  expect(seenPrefixes[0]).toBe(seenPrefixes[1])            // stable across iterations
  expect(seenTools[0].sort()).toEqual(["glob", "read"])     // write/shell/edit/grep filtered out
  expect(seenPrefixes[0]).toContain("- read:")              // # Tools section lists the agent's toolset
  expect(seenPrefixes[0]).not.toContain("- write:")          // excluded tools stay out of the prompt too
  expect(store.loadSession(session.id)?.agent).toBe("reviewer")
  store.close()
})

test("e2e: a plan turn cannot edit — the tool is withheld and refused", async () => {
  const store = new Store(DB)
  const session = store.createSession("fake", "fake-model", ROOT, "plan")
  const tools = makeTools(ROOT)
  const plan = loadAgents(ROOT).find(a => a.id === "plan")!
  expect(plan.prompt).toContain("plan mode")

  const seenPrefixes: string[] = []
  const seenTools: string[][] = []
  let step = 0
  const provider = {
    chat: async (a: any) => {
      seenPrefixes.push(a.messages[0].content)
      seenTools.push(a.tools.map((t: any) => t.name))
      step++
      if (step === 1) return { content: "", toolCalls: [{ id: "t1", name: "edit", args: { path: "src.txt", oldString: "42", newString: "43" } }] }
      return { content: "plan: change src.txt line 1 from 42 to 43", toolCalls: [] }
    },
  }

  const r = await runTurn({
    store, provider, tools, agent: plan,
    signal: new AbortController().signal,
    onAsk: async () => "y" as const,
    promptInput: {
      cwd: ROOT, os: "linux", gitBranch: null, date: "2026-10-22",
      agentsMd: null, skills: [],
      tools: toolsForAgent(tools, plan).map(t => ({ name: t.name, description: t.description, schema: t.schema })),
      agentPrompt: plan.prompt,
    },
  }, session.id, "change 42 to 43")

  expect(r.aborted).toBe(false)
  expect(seenPrefixes[0]).toContain("plan mode")              // plan's prompt replaces the base
  expect(seenPrefixes[0]).not.toContain("a coding agent working in the user's terminal")
  expect(seenTools[0]).not.toContain("edit")
  expect(seenTools[0]).not.toContain("write")
  expect(seenTools[0]).toContain("read")
  expect(seenTools[0]).toContain("shell")                   // shell stays, permission-controlled
  expect(seenPrefixes[0]).not.toContain("- edit:")
  const refused = store.getMessages(session.id).find(m => m.role === "tool")
  expect(refused?.content).toBe("unknown tool: edit")        // even if the model tries, nothing runs
  expect(readFileSync(`${ROOT}/src.txt`, "utf8")).toBe("42\n")   // the file is untouched
  store.close()
})
