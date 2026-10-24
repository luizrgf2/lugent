# Decisions — Core — store, prompt, permissions, provider

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

## 2026-10-23 — yolo mode bypasses every permission check, including outside-project
Decision: `/permissions → yolo` makes `runTurn` auto-approve all tool calls — no ask dialogs, no outside-project forced confirmation.
Why: power users want an opt-in fast path; scoping yolo per-tool re-adds the config surface it exists to avoid.
Cost if wrong: one yolo session can read/write outside the project root without any prompt — explicit opt-in only, never a default; status bar shows YOLO while active.

## 2026-10-23 — image attachments: `@path` marker expanded to OpenAI vision parts at turn start
Decision: `@path/to.png` anywhere in the user's message expands (CLI layer, `src/core/images.ts`) into `[{type:"text"},{type:"image_url",image_url:{url:"data:..."}}]` for the newest user message only; the stored message keeps the raw marker text and images are re-read from disk each turn.
Why: one wire format serves every provider behind an OpenAI-compatible proxy (no per-provider code); turn-scoped expansion keeps SQLite schema and session replay untouched; video (`video_url`) was cut — no cross-provider shape exists.
Cost if wrong: image files must keep existing across turns (replay re-reads them); models without vision reject content-parts arrays — the marker stays literal only when the file doesn't resolve, not when the model can't see images.

---

Index: [`docs/decisions.md`](../decisions.md) — one file per area, chronological within each.
