import { readFileSync } from "node:fs"
import type { PromptInput } from "../core/prompt"
import type { Agent } from "../core/types"
import { toolsForAgent } from "../core/agents"
import type { ReplEnv } from "./repl"

export function safeBranch(root: string): string | null {
  try {
    return readFileSync(`${root}/.git/HEAD`, "utf8").replace("ref: refs/heads/", "").trim()
  } catch { return null }
}

export function safeAgentsMd(root: string): string | null {
  try { return readFileSync(`${root}/AGENTS.md`, "utf8") } catch { return null }
}

export function buildPromptInput(env: ReplEnv, _model: string, agent?: Agent): PromptInput {
  const tools = toolsForAgent(env.tools, agent)
  return {
    cwd: env.projectRoot,
    os: process.platform,
    gitBranch: safeBranch(env.projectRoot),
    date: new Date().toISOString().slice(0, 10),
    agentsMd: safeAgentsMd(env.projectRoot),
    // An agent that excluded the skill tool must not be told skills exist (no agent → unchanged).
    skills: agent && !tools.some(t => t.name === "skill") ? [] : env.skills,
    tools: tools.map(t => ({ name: t.name, description: t.description, schema: t.schema })),
    agentPrompt: agent?.prompt,
  }
}
