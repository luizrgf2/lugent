# Decision log

Append-only. Format and inclusion rules: `.agents/skills/git-conventions/SKILL.md`.

## 2026-10-22 — core lib pura + REPL in-process
Decision: v1 is a REPL CLI calling `src/core/` directly; no HTTP server.
Why: one binary, no transport layer to test; HTTP API is a v2 feature with its own trigger.
Cost if wrong: embedding lugent programmatically needs the loop API refactored — core is already UI-free, so surface is small.

## 2026-10-22 — zero runtime dependencies
Decision: stdlib/Bun only (`bun:sqlite`, `Bun.spawn`, `Bun.Glob`, `fetch`); no SDK, no framework.
Why: minimal audit surface, no version churn, Bun covers everything v1 needs.
Cost if wrong: first complex feature (MCP client, real JSON-Schema validation) forces a dep addition — fine, just deliberate.

## 2026-10-22 — append-only store, repaired on read
Decision: messages never edited after insert; `cleanHistory` strips orphan `tool_calls`/results at request time.
Why: aborts and crashes leave assistant calls without result rows; orphans 400 the provider. Repair-on-read keeps the write path trivial.
Cost if wrong: a repair bug silently rewrites what the model saw vs what the DB has — golden e2e pins the wire format.

## 2026-10-22 — outside-project check is pattern-level
Decision: `..` / `~` / absolute-prefix check forces `ask`; no symlink audit.
Why: full path auditing is v1 overkill; pattern check covers the common escapes.
Cost if wrong: a symlink inside the project pointing to a secret becomes readable after one session grant. Upgrade path: real path resolution in `isOutsideProject`.

## 2026-10-22 — deferred: minor review findings F6–F18
Decision: 13 minor findings (401 retry, usage meta, process-group kill, buffer caps, FK pragma, …) left unfixed.
Why: none break core function; fix cost exceeded blast radius at v1.
Cost if wrong: long sessions may hit unbounded shell output (F9) or slow 4xx errors (F6). Full list: git history, commit `fix: review findings F1-F5`.

## 2026-10-22 — internal specs stay off origin
Decision: `docs/specs/` and `docs/plans/` are gitignored; main history was rewritten to drop them before first push.
Why: internal design docs must not reach the public repo.
Cost if wrong: pushing from an old ref (reflog, stale branches) leaks spec blobs. Never revive pre-rewrite refs.

## 2026-10-22 — doc-check enforcement via session.idle, not per-tool
Decision: the end-of-iteration doc check is enforced by an OpenCode plugin (`.opencode/plugins/doc-check`) that marks sessions on write/edit/patch and reminds on `session.idle` — once per mutation batch, 10min cooldown.
Why: per-tool reminder (`tool.execute.after`) fires mid-turn and spams; `session.idle` is the true end-of-implementation trigger. The reminder arrives as a synthetic message the model answers next step.
Cost if wrong: synthetic message wakes the model once more per batch (small token cost); reminder relies on event field shapes from @opencode/plugin 2.1.3 — a breaking event change silently disables it.

## 2026-10-22 — CLI UI: hand-rolled ANSI, not Ink
Decision: all terminal styling (`src/cli/ui.ts`) is hand-rolled — `util.styleText`, raw escapes, box-drawing chars, frame-based spinner. No Ink/ora/chalk/picocolors.
Why: zero runtime dependencies is a declared constraint of the project; `util.styleText` is native in Bun; a REPL needs a small subset (colors, one box, one spinner, per-tool glyphs) that fits ~90 lines. Styling is gated on `isTTY` so piped output stays plain for tests/scripts.
Cost if wrong: no full-screen reactive layout or resize handling — if lugent ever wants panes/full TUI, Ink (what Claude Code uses) is the upgrade, but it breaks the zero-dep constraint and should be its own decision.

## 2026-10-22 — Break zero-dep for the TUI: react + ink
Decision: the CLI TUI layer uses react@19 + ink@8; the pure core (`src/core/`) stays zero-dependency.
Why: full-screen reactive UIs (Claude Code, Gemini CLI, Shopify CLI) are built on React renderers; hand-rolled ANSI cannot do scrollable transcript + fixed composer + dialogs without cursor-math debt. Ink is the most documented choice. The constraint is now scoped to where it buys something (core testability, no supply chain in the engine).
Cost if wrong: ~2-3MB of deps and a React upgrade surface on the CLI layer; if the TUI experiment regresses, `--plain` REPL is the always-working fallback.

## 2026-10-22 — Model reasoning is display-only
Decision: `provider.chat` forwards `delta.reasoning_content` via `onReasoning` for live display; reasoning is never written to the store nor replayed.
Why: persisting it means a message-schema migration for marginal value — reasoning is most useful while streaming, and next-turn history works better with final content only.
Cost if wrong: session replay shows no reasoning (accepted until a replay feature exists); if a provider requires reasoning echoed back in history, a schema change is needed.

## 2026-10-22 — Own ink test harness instead of ink-testing-library
Decision: `src/cli/tui/harness.tsx` renders through ink's real `render()` against fake stdin/stdout; ink-testing-library removed.
Why: ink-testing-library@4 declares `ink: ^5` — on ink v8 it triplicates input events and returns stale frames. The harness is ~40 lines, dev-only, and exercises the production renderer.
Cost if wrong: harness maintenance is ours; replace it when a testing lib with v8 support ships.
