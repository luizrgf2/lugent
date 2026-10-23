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
