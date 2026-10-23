# AGENTS.md

lugent: minimal OpenCode-style coding agent. TS + Bun, **zero runtime dependencies** (constraint — do not add any). Pure core (`src/core/`, UI-free), thin CLI (`src/cli/`, owns the terminal), entry `src/main.ts`.

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
| `src/core/prompt.ts` (prefix, buildMessages) | `docs/architecture.md` § "Byte-stable prefix" — snapshot must stay byte-identical unless the change is deliberate |
| `src/core/provider.ts` (SSE, retry, health) | `docs/architecture.md` § "SSE fragment accumulation" |
| `src/core/loop.ts` / abort / history repair | `docs/architecture.md` § "Append-only store, repaired on read" + § "Turn flow" |
| `src/core/store.ts` | `docs/architecture.md` § "Schema" |
| permissions (`permissions.ts`, tool `permission` field) | `docs/architecture.md` § "Permissions" |
| adding/changing a tool | `README.md` § "Tools" (keep table + defaults in sync) |
| config loading (`config.ts`) | `README.md` § "Configuration" (precedence, `{env:VAR}`) |
| branch or commit | `.agents/skills/git-conventions/SKILL.md` |
| a decision with a trade-off | append to `docs/decisions.md` (format in the skill above) |
| a request near v1's edge (subagents, MCP, compaction) | `docs/future-features.md` — check the trigger before designing |

When you create a new doc: single topic, short, and add a trigger row here. If a doc grows past ~150 lines, split it and update this index.

Note: lugent itself loads this file into its system prompt (`safeAgentsMd` in `src/cli/repl.ts`) — it doubles as dogfooded instructions.
