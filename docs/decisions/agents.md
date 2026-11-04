# Decisions — Agents

## 2026-10-23 — Agents: markdown only, no config-file agents
Decision: Agents are `.agents/agents/*.md` files (body = system prompt), mirroring the skills loader; no `agents` key in `lugent.json`.
Why: Long prompts in JSON are unmaintainable, and markdown + frontmatter is already this repo's lived format for skills.
Cost if wrong: Teams wanting agents in one committed config file must add one file per agent instead; the JSONC path of OpenCode stays unimplemented.

## 2026-10-23 — Agents: simple tools list and permission map, no rule engine
Decision: `tools: [...]` plus `permissions: {tool: allow|ask|deny}`. No wildcards, no per-resource patterns, no last-match-wins ordering.
Why: The real use cases (read-only reviewer, shell ask, edit deny) need one flag per tool; the full rule engine stays deferred in `future-features.md`.
Cost if wrong: Policies like "deny `git push`, allow `git status`" are impossible until the rule engine lands; the loader's frontmatter shape stays compatible.

## 2026-10-23 — Per-agent byte-stable prefix, switch invalidates the cache once
Decision: The system prefix is byte-stable within an agent (golden snapshot per fixture), but switching agent mid-session changes the prefix and loses the provider prompt cache for one request.
Why: The agent's system prompt must replace the base prompt to be an agent (OpenCode semantics); keeping the base prompt under it would bloat tokens and defeat read-only agents.
Cost if wrong: Sessions that flip agents often pay a cache miss each switch; a future "reasoning-less prefix" split could isolate the volatile part.

## 2026-10-23 — Built-in agents: `build` (default) and `plan`, compiled into the loader
Decision: `BUILTIN_AGENTS` lives in `agents.ts` and merges *before* the user and project file scopes; `build` reuses `SYSTEM_PROMPT` verbatim and is what `resolveAgent` falls back to (`defaultAgent` unset or unknown); `plan` denies `edit`/`write` and keeps every other tool — `shell` stays permission-controlled.
Why: "always ships with lugent" cannot rely on files — `package.json` publishes `src/` only, so a separate asset tree would need a new shipping mechanism, while a constant arrives with the code and can still be overridden by a same-id file (OpenCode's override rule). Reusing the base prompt keeps the default prefix byte-identical, so nobody pays a cache miss for a feature they didn't ask for, and it gives the "no way back to a plain agent" gap a home: `/agent build`.
Cost if wrong: the built-in prompts are code, so rewording `plan` is a commit unless the user shadows it with their own `plan.md`; `plan` blocks only what a tool list can express — a shell command can still write (`echo > f`), exactly as in OpenCode, so `plan` is a planning guard, not a sandbox.

## 2026-10-23 — Project-scoped agents may grant `allow`; scope restriction deferred
Decision: a project repo can ship `.agents/agents/*.md` with `permissions: {shell: allow}` (and a `defaultAgent` in `lugent.json`), so switching to that agent runs those tools without prompting. Project scope wins over user scope by id, exactly like skills.
Why: project `AGENTS.md` and skills are already trusted-repo channels; a trust prompt or a user-only `allow` rule is a product decision with no user asking for it yet. The `/agent` switch line now reports the resulting toolset, so the widening is visible at the moment it happens.
Cost if wrong: cloning a hostile repo and switching to (or defaulting into) its agent silently widens permissions to whatever that agent allows; the outside-project guard still forces ask for paths outside the project.

## 2026-10-23 — Agent display colors: per-agent `color` field with built-in defaults
Decision: `Agent.color` (optional, frontmatter `color:`) accepts an ink color name or `#rrggbb`; invalid warns and falls back. Built-ins carry defaults (`build` magenta, `plan` yellow) and agents without a color inherit magenta. The TUI shows a fixed context line above the input: yellow `§ AGENTS.md loaded` when a project `AGENTS.md` was read, plus `· agent <id>` in the agent's color.
Why: the user asked "does lugent support per-agent colors?" — it didn't; the status bar already showed the agent id, so the color slot existed visually but not in data. Defaults on built-ins mean the line is colored out of the box; fallback keeps legacy agent files valid without touching them.
Cost if wrong: two agents can pick the same color (no uniqueness check) — acceptable, color is a hint not an identity; hex parsing accepts `#rgb` shorthand ink also accepts, so no divergence.

## 2026-11-03 — Subagents: one `subagent` tool with a `# Subagents` catalog
Decision: `mode: primary|subagent|all` on the agent profile; a single `subagent` tool takes an `agent` id and a `prompt`; the catalog of launchable agents (id + description) is advertised in a `# Subagents` prompt section, not in the tool description.
Why: Mirrors OpenCode (one stable tool, id parameter) while keeping the tool description short and the catalog as legible as `# Skills`. The section is rendered only when non-empty, so no `mode: subagent` agent means no prefix change (the golden snapshot stays byte-identical).
Cost if wrong: two places describe subagents (section + tool schema); a model that ignores the section can still call the tool and earn an "unknown subagent" error.

## 2026-11-03 — A subagent is another `runTurn`, in the same process
Decision: the `subagent` tool receives a `ctx.spawn` closure that `runTurn` itself builds; spawn creates a child session and calls the same `runTurn`, returning the child's last assistant message. No child process, no separate loop function.
Why: a child is the current chat instantiated again — same loop, same reason to change — so reusing `runTurn` avoids a second code path that would drift. It is asynchronous concurrency (a promise), not OS parallelism.
Cost if wrong: the loop must own the spawn wiring (deps for agents/config/provider); a future background-subagent mode needs a lifecycle outside a single awaited call.

## 2026-11-03 — Subagent depth is 1; the child never gets the tool
Decision: `spawn` filters `subagent` out of the child toolset and sets the child's catalog to empty, so a child cannot launch a grandchild.
Why: matches OpenCode's default and closes the recursion/cost loop with no depth counter — the tool simply does not exist for the child.
Cost if wrong: a genuinely hierarchical task must be flattened by the parent; making depth configurable later means carrying a depth value on the session.

## 2026-11-03 — Child sessions are hidden from the session list
Decision: `listSessions` excludes rows with a non-null `parent`; the child is persisted and addressable by id (and via `children(parentId)`), but `/resume` and the TUI picker show only top-level sessions.
Why: the child's answer already lives in the parent's transcript; listing children would clutter the picker for no user action. Hiding is one SQL predicate.
Cost if wrong: inspecting a past child needs its id or a future child browser; no data is lost.

## 2026-11-03 — `general`: a built-in subagent, so delegation works out of the box
Decision: `BUILTIN_AGENTS` gains `general` — `mode: subagent`, full toolset, tool-default permissions, cyan — mirroring OpenCode's default delegate; it shadows like any built-in (`.agents/agents/general.md`).
Why: without it the `subagent` tool errors "unknown subagent" in a clean install, and the whole feature is invisible until the user writes a file; OpenCode ships `general` for the same reason.
Cost if wrong: every default prefix now carries a one-line `# Subagents` section (the golden snapshot still pins stability, and a project shadowing `general` with a primary-mode file removes it); the built-in's prompt is code, so rewording is a commit.

## 2026-11-04 — Frontmatter `name` is the agent id; the path is the fallback
Decision: `loadAgentFile` takes the id from a non-empty `name` field; the file's relative path stays the fallback, and scope precedence compares the final id (project beats user on equal `name`).
Why: external agent files (Claude Code style) nest them (`reviewer/agent.md`) and pin the identity in frontmatter — a path-derived id like `reviewer/agent` is noise the user never typed, and `/agent reviewer/agent` is hostile. Explicit identity matches the repo's "the name should be explicit" rule.
Cost if wrong: renaming an agent's `name` orphans old sessions that reference the old id — `/resume` falls back to the session's stored prompt-less state (agent not found → base prompt), never an error.

## 2026-11-04 — Legacy Claude Code fields are translated, not dropped
Decision: the loader maps `subagent: true` → `mode: subagent` (deprecation warning; explicit `mode` wins), `commandExecutionPolicy: off` → `permissions: {shell: deny}` unless the same file declares `permissions.shell` explicitly, and accepts `mode: agent` as a spelling of `primary`. `description` strips surrounding quotes like `color` already did.
Why: real agent files in other repos carry these fields; silently ignoring them changes behavior (a read-only reviewer silently gains shell, a subagent silently becomes unlaunchable), while dropping the file is worse. Translation keeps one canonical format with loud warnings pointing at the canonical spelling.
Cost if wrong: two spellings for one concept live forever in docs and code; the warnings are the pressure that retires them.

## 2026-11-04 — Subagent model hierarchy: agent → `defaultSubagentModel` → chat; unresolved declared models are fatal
Decision: `resolveChildModel` walks the subagent's declared `model`, then the config's `defaultSubagentModel`, then the chat's current model. `agentActivationModel` covers primary activation (switch/startup/resume). A declared model whose provider is not configured is fatal everywhere: spawn stops before creating a child session (loop `onFatal` seam; CLI prints and exits 1), the plain REPL exits at activation, the TUI picker/resume refuse the switch with an error item (a rendered UI cannot exit mid-picker).
Why: a model declaration is a contract — silently inheriting the chat's model runs the child on the wrong provider at real cost (wrong context length, wrong pricing, wrong behavior), the exact failure mode the user hit with `model: flash`. Explicit-but-unhonored must fail loudly at the moment of activation, not mid-turn.
Cost if wrong: a typo'd provider in an agent file now kills the REPL at switch time instead of degrading — intended fail-loud; `defaultSubagentModel` with a dead provider is likewise fatal at spawn, so the config must be checked after edits.

---

Index: [`docs/decisions.md`](../decisions.md) — one file per area, chronological within each.
