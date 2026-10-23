import { readFileSync } from "node:fs"
import type { PromptInput } from "../../core/prompt"
import type { ReplEnv } from "./repl"

export function safeBranch(root: string): string | null {
  try {
    return readFileSync(`${root}/.git/HEAD`, "utf8").replace("ref: refs/heads/", "").trim()
  } catch { return null }
}

export function safeAgentsMd(root: string): string | null {
  try { return readFileSync(`${root}/AGENTS.md`, "utf8") } catch { return null }
}

export function buildPromptInput(env: ReplEnv, _model: string): PromptInput {
  return {
    cwd: env.projectRoot,
    os: process.platform,
    gitBranch: safeBranch(env.projectRoot),
    date: new Date().toISOString().slice(0, 10),
    agentsMd: safeAgentsMd(env.projectRoot),
    skills: env.skills,
    tools: env.tools.map(t => ({ name: t.name, description: t.description, schema: t.schema })),
  }
}
