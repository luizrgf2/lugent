# AGENTS.md

lugent: minimal OpenCode-style coding agent. TS + Bun, **zero runtime dependencies** (constraint — do not add any). Pure core (`src/core/`, UI-free), thin CLI (`src/cli/`, owns the terminal), entry `src/main.ts`.

## Commands

- `bun test` — full suite (single file: `bun test src/core/loop.test.ts`)
- `bun src/main.ts [--db <path>]` — run the REPL
- No lint/typecheck scripts; keep types strict via `tsconfig.json`

## Conventions & gotchas

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

## Architecture pointers

Turn flow, design decisions (orphan `tool_calls` repair in `cleanHistory`, SSE fragment accumulation by index, permissions layers, truncation) and schema: `docs/architecture.md`. User-facing config/tools/skills reference: `README.md`.

Note: lugent itself loads this file into its system prompt (`safeAgentsMd` in `src/cli/repl.ts`) — it doubles as dogfooded instructions.
