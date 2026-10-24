# AGENTS.md

lugent: minimal OpenCode-style coding agent. TS + Bun. **Pure core (`src/core/`) has zero runtime dependencies — do not add any.** The CLI layer may use `react`/`ink` for the TUI (`src/cli/tui/`, decision-logged); the plain REPL (`src/cli/`) stays ANSI-only (`src/cli/ui.ts`).

## Commands

- `bun test` — full suite (single file: `bun test src/core/loop.test.ts`)
- `bun src/main.ts [--db <path>]` — run the REPL
- No lint/typecheck scripts; keep types strict via `tsconfig.json`

## Conventions & gotchas

- **Before creating a branch or a commit**: read `.agents/skills/git-conventions/SKILL.md` (branch names, commit types, decision-log rules). Decision log lives in `docs/decisions.md`.

- **TDD**: test file next to module (`foo.ts` / `foo.test.ts`). Watch it fail before implementing. This repo was built entirely test-first.
- **Golden snapshot** `src/core/__snapshots__/prompt.test.ts.snap` pins the system prompt byte-for-byte (provider prefix-cache stability). If `src/core/prompt.ts` changes deliberately, update with `bun test -u` — accidental drift is a bug.
- **`Bun.Glob.scan()` is an AsyncGenerator** — `Array.from()` on it silently yields `[]`. Use `scanSync()`.
- **Config tests must pass an explicit `globalPath`** — `~/.config/lugent/config.json` exists on this machine with a real API key and leaks into `loadConfig()` tests otherwise.
- **Windows support goes through `src/core/platform.ts`** (pure functions: db path, shell command). Don't sprinkle `process.platform` elsewhere.
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`). Docs in English.

## Never commit / never push

- `~/.config/lugent/config.json` (real provider key) — never copy into repo, README, or examples.
- `docs/specs/` and `docs/plans/` are local-only (gitignored internal design docs). History was rewritten once specifically to keep them off `origin` — never re-add or push them from old refs/reflog.
- No `lugent.json` belongs in this repo.

## Doc index — read only what the trigger matches

Documentation pattern for this repo: **one small doc per topic, never one big file**. `AGENTS.md` holds only triggers and pointers; the detail lives in the target doc. Don't read them all upfront — follow the trigger.

| If you touch… | Read |
| --- | --- |
| `src/core/prompt.ts` (prefix, buildMessages, the always-present `# MCP` section) | `docs/architecture.md` § "Byte-stable prefix" — snapshot must stay byte-identical unless the change is deliberate; before growing the `# MCP` section, read `docs/decisions.md` (2026-10-24, always-loaded prompt section) for the promotion trigger |
| `src/core/provider.ts` (SSE, retry, health) | `docs/architecture.md` § "SSE fragment accumulation" |
| `src/core/loop.ts` / abort / history repair | `docs/architecture.md` § "Append-only store, repaired on read" + § "Turn flow" |
| `src/core/store.ts` | `docs/architecture.md` § "Schema" |
| permissions (`permissions.ts`, tool `permission` field) | `docs/architecture.md` § "Permissions" |
| adding/changing a tool | `README.md` § "Tools" (keep table + defaults in sync) |
| config loading (`config.ts`) | `README.md` § "Configuration" (precedence, `{env:VAR}`) |
| `src/core/skills.ts` (skill loading) | `README.md` § "Skills" — user `~/.agents/skills` + project `.agents/skills`; same id → project wins |
| `src/core/agents.ts` (agent format, tools/permissions, built-ins `build`/`plan`, `/agent`) | `README.md` § "Agents" |
| `src/core/mcp/*` (transports, client, tool bridge, manager) | `docs/architecture.md` § "MCP" — transport seam + legacy `initialize` revision; `README.md` § "MCP" |
| branch or commit | `.agents/skills/git-conventions/SKILL.md` |
| `src/cli/ui.ts` (ANSI, box, spinner) | zero-dep: no color/TUI lib; gate all styling on `isTTY` so piped output stays plain; keep pure formatters tested in `ui.test.ts` |
| `src/cli/tui/*` (Ink TUI) | reasoning is display-only (never persisted); core must not import react/ink; test via `harness.tsx` (ink-testing-library is incompatible with ink v8) |
| a decision with a trade-off | append to `docs/decisions.md` (format in the skill above) |
| a request near v1's edge (subagents, MCP, compaction) | `docs/future-features.md` — check the trigger before designing |

When you create a new doc: single topic, short, and add a trigger row here. If a doc grows past ~150 lines, split it and update this index.

## End-of-iteration doc check

Enforced by `.opencode/plugins/doc-check` — on `session.idle`, if code changed without docs, the plugin injects a reminder into the session. The rules below are what that check enforces (and what to run yourself when it can't, e.g. outside OpenCode).

Before each commit (or declaring a task done), diff what changed against the docs and update whatever is stale:

- `git diff --stat` + the commit subject vs the trigger table above
- New/changed tool, flag, or slash command → `README.md` § Tools / Usage
- Config field, precedence, or `{env:}` change → `README.md` § Configuration
- Module added/removed or flow change → `docs/architecture.md` + trigger row here
- Trade-off accepted or work deliberately deferred → `docs/decisions.md` entry (format in the git-conventions skill)
- Any user-visible behavior change → `README.md`

No match (internal-only refactor, test tweaks) → state "docs: no update needed" and move on. Doc updates ship in the same commit as the code they describe.

Note: lugent itself loads this file into its system prompt (`safeAgentsMd` in `src/cli/context.ts`) — it doubles as dogfooded instructions.
