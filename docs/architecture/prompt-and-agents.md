# Prompt and agents

**Built-in agents.** `BUILTIN_AGENTS` (`build`, `plan`) is hardcoded in `agents.ts` and merged *before* the file scopes, so every install has both and a file with the same id overrides one instead of removing it. `build.prompt` is `SYSTEM_PROMPT` itself — one source of truth, and the default prefix stays byte-identical (the golden snapshot keeps guarding it). `resolveAgent(agents, id)` is the single resolution point: requested id if it exists, else `build` (what `defaultAgent` unset and an unknown id both land on); sessions store the resolved id, and a `null` agent (a session created before agents shipped) keeps the base prompt. New sessions therefore start on `build`, which is also the way back from `plan`.

**Byte-stable prefix.** The system prompt is rebuilt from immutable inputs every iteration and pinned by a golden snapshot test. Identical bytes across requests let providers reuse their prompt cache — one changing line silently kills caching. A selected agent's prompt *replaces* the base prompt and gets its own pinned snapshot, so the prefix is byte-stable per agent; switching agent invalidates the cache once. The `# MCP` section sits *before* the agent prompt precisely because it must not be replaced: every agent, built-in or user-defined, receives it. It is unconditional so a user with no server configured can still ask how to add one (see `docs/decisions.md`).

**Subagents catalog.** The `# Subagents` section lists `id` + `description` for every `canBeSubagent` agent (mode `subagent` or `all`), right after `# Skills`. It renders only when the list is non-empty — a project with no subagents (or an agent that withheld the `subagent` tool) keeps the old prefix byte-for-byte, which the golden snapshot pins. A child session's `PromptInput` sets `subagents: []`, so the section vanishes in the child and the depth-1 rule needs no code in the prompt itself (see `docs/decisions/agents.md`).

---

Index: [`docs/architecture.md`](../architecture.md)
