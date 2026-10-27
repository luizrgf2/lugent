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

## 2026-10-27 — every unbounded loop gets a hard ceiling (runaway guards)

Decision: three caps, all constants — `runTurn` stops at 50 tool rounds per turn and stores a final `user` message telling the model to summarize; `McpClient.listTools` stops past 100 pagination pages and fails the server; `parseSSE` ends any stream older than 10min (`totalTimeoutMs`), keep-alive bytes included.

Why: each guarded an unbounded loop reachable without user error — a degenerate model re-emitting tool calls bills and runs forever (history grows per round, so it gets slower too), a buggy or hostile MCP server that always returns a fresh `nextCursor` hangs the entire startup behind `connectAll`, and a proxy that drips SSE heartbeats defeats the idle guard (any byte resets it) leaving the spinner forever. Constants, not config: no real workload approaches 50 rounds / 100 pages, and a knob here is a knob whose wrong value re-introduces the hang.

Cost if wrong: a genuinely huge task that needs >50 rounds is cut short mid-flight — the stored cap message means the user just sends "continue" and the turn resumes with fresh budget; a server with >100 pages of tools (>100k tools at typical page size) fails to connect — bump `MAX_LIST_PAGES` when one actually exists. The 10min total cap can be legitimately short for a very long single-stream generation — raise the default then, not with a config field now.

Index: [`docs/decisions.md`](../decisions.md) — one file per area, chronological within each.
