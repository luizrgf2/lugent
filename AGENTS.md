# AGENTS.md

lugent: minimal OpenCode-style coding agent. TS + Bun. **Pure core (`src/core/`) has zero runtime dependencies — do not add any.** The CLI layer may use `react`/`ink` for the TUI (`src/cli/tui/`, decision-logged); the plain REPL (`src/cli/`) stays ANSI-only (`src/cli/ui.ts`).

## Commands

- `bun test` — full suite (single file: `bun test src/core/loop.test.ts`)
- `bun src/main.ts [--db <path>]` — run the REPL
- No lint/typecheck scripts; keep types strict via `tsconfig.json`

## Conventions & gotchas

- **Before creating a branch or a commit**: read `.agents/skills/git-conventions/SKILL.md` (branch names, commit types, decision-log rules). Decision log: `docs/decisions.md` is the index — new entries go to the area file under `docs/decisions/`.

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

## Docs layout & rules

`docs/` is the documentation. `README.md` is **not** docs — it is the front door for someone arriving at the repo: install, configuration, usage, one section per feature, with an `Index:` line at the end of the sections that have detail here. Detail belongs in `docs/`; README links into it.

```
docs/README.md           flat map of the whole tree — start here when browsing
docs/architecture.md     index  →  docs/architecture/*.md    one topic per file
docs/decisions.md        index  →  docs/decisions/*.md       one area per file
docs/future-features.md  deferred work, each with the trigger that un-defers it
docs/specs/ docs/plans/  internal design records — gitignored, never pushed
```

Rules:

- **One topic per file.** A file that needs an "and also…" gets split in two.
- **The canonical path becomes the index — never a stub.** `docs/architecture.md` and `docs/decisions.md` sit outside their own folders on purpose: splitting must not move a path that code comments, specs and old commits already link to. The index holds the map, the folder holds the detail.
- **~150 lines is the ceiling.** Past it: split it, link the parts from the area index and `docs/README.md`, add a trigger row below. Split files end with an `Index:` backlink to their area index.
- **Reachable twice.** Every doc is linked from `docs/README.md` (the tree) and from its area index (the topic list). A new doc needs both, or it is invisible.
- **Decisions append to the area file** — `docs/decisions/{core,cli-tui,agents,mcp,process}.md`, chronological inside each, newest last. Never append to the index, and never open a new area without a reason (add one when a whole subsystem has no home).
- **A doc with no trigger row is a doc nobody reads.** Adding a doc means adding its row below.

## Doc index — read only what the trigger matches

Documentation pattern for this repo: **one small doc per topic, never one big file**. `AGENTS.md` holds only triggers and pointers; the detail lives in the target doc. Don't read them all upfront — follow the trigger. Flat map of the tree: `docs/README.md`.

| If you touch… | Read |
| --- | --- |
| `src/core/prompt.ts` (prefix, buildMessages, the always-present `# MCP` section) | `docs/architecture/prompt-and-agents.md` — snapshot must stay byte-identical unless the change is deliberate; before growing the `# MCP` section, read `docs/decisions/mcp.md` (2026-10-24, always-loaded prompt section) for the promotion trigger |
| `src/core/provider.ts` (SSE, retry, health) | `docs/architecture/provider.md` |
| `src/core/loop.ts` / abort / history repair | `docs/architecture/persistence.md` + `docs/architecture/turn-flow.md` |
| `src/core/store.ts` | `docs/architecture/persistence.md` (schema) |
| permissions (`permissions.ts`, tool `permission` field) | `docs/architecture/permissions.md` |
| adding/changing a tool | `README.md` § "Tools" (keep table + defaults in sync) |
| config loading (`config.ts`) | `README.md` § "Configuration" (precedence, `{env:VAR}`) |
| `src/core/skills.ts` (skill loading) | `README.md` § "Skills" — user `~/.agents/skills` + project `.agents/skills`; same id → project wins; how it reaches the prefix: `docs/architecture/prompt-and-agents.md` |
| `src/core/agents.ts` (agent format, tools/permissions, built-ins `build`/`plan`, `/agent`) | `README.md` § "Agents" + `docs/architecture/prompt-and-agents.md` + `docs/decisions/agents.md` |
| `src/core/mcp/*` (transports, client, tool bridge, manager) | `docs/architecture/mcp.md` — transport seam + legacy `initialize` revision; `README.md` § "MCP" |
| `src/core/mcp/oauth/*` (discovery, PKCE, callback, token, store, flow) | `docs/architecture/mcp-oauth.md` + `README.md` § "MCP" — https-only discovery, the `FetchImpl` seam, token storage rules |
| branch or commit | `.agents/skills/git-conventions/SKILL.md` |
| `src/cli/ui.ts` (ANSI, box, spinner) | zero-dep: no color/TUI lib; gate all styling on `isTTY` so piped output stays plain; keep pure formatters tested in `ui.test.ts` |
| `src/cli/tui/*` (Ink TUI) | reasoning is display-only (never persisted); core must not import react/ink; test via `harness.tsx` (ink-testing-library is incompatible with ink v8); see `docs/architecture/tui.md` |
| `src/cli/logo.ts` (shared raster + gradient, `LOGO_HEIGHT`, `CHROME_HEIGHT`, `logoTopPad`) | `docs/architecture/tui.md` — the height constants are load-bearing: the transcript window subtracts them from the real terminal rows, so a new row here or a new chrome line must update both sides (see `docs/decisions/cli-tui.md` 2026-11-01 on the splash pad) |
| `src/cli/tui/mouse.ts` (wheel scroll, stdin proxy) | `docs/decisions/cli-tui.md` 2026-11-01 — ink has no mouse support; the proxy must keep one chunk per read or `\r` glues to text |
| a decision with a trade-off | append to the area file under `docs/decisions/` (index: `docs/decisions.md`; format in the skill above) |
| a request near v1's edge (subagents, MCP, compaction) | `docs/future-features.md` — check the trigger before designing |
| anything else | `docs/README.md` — the flat map of the whole docs tree |

Adding or splitting a doc: see the rules in "Docs layout & rules" above.

## End-of-iteration doc check

Enforced by `.opencode/plugins/doc-check` — on `session.idle`, if code changed without docs, the plugin injects a reminder into the session. The rules below are what that check enforces (and what to run yourself when it can't, e.g. outside OpenCode).

Before each commit (or declaring a task done), diff what changed against the docs and update whatever is stale:

- `git diff --stat` + the commit subject vs the trigger table above
- New/changed tool, flag, or slash command → `README.md` § Tools / Usage
- Config field, precedence, or `{env:}` change → `README.md` § Configuration
- Module added/removed or flow change → the matching file under `docs/architecture/` (+ its index, if the set changed) + trigger row here
- Trade-off accepted or work deliberately deferred → entry in the matching area file under `docs/decisions/` (format in the git-conventions skill)
- Any user-visible behavior change → `README.md`

No match (internal-only refactor, test tweaks) → state "docs: no update needed" and move on. Doc updates ship in the same commit as the code they describe.

Note: lugent itself loads this file into its system prompt (`safeAgentsMd` in `src/cli/context.ts`) — it doubles as dogfooded instructions.
