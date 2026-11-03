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

## 2026-10-30 — Provider: silent error paths surfaced, visible retries (`src/core/provider.ts`)

Context: a 503 from a dead API was retried silently and, worse, two paths never showed anything at all — a mid-stream SSE `error` event fell through the `delta` checks and the turn ended "successfully" empty, and some gateways answer 200 with a JSON error body that parses as zero SSE events. Retries (3 attempts) were also invisible: no callback, 200/400ms sleeps that ignored the abort signal.

Decision: both silent paths now throw (`ev.error` → `Error(error.message)`; 200 + `content-type: application/json` → parsed error or `non-stream 200 response`), backoff is 500ms→1s with an `onRetry({attempt, delayMs, error})` callback the REPL prints and the TUI shows above the context line, the backoff sleep races the `AbortSignal`, and the final throw appends `(after 3 attempts)`. A turn already mid-stream that errors is still retried (accepted: the partial `onToken` text can duplicate on the retry — stalling-after-emitting is rare, and not retrying would fail turns the old stall test promises to recover).

Ponytail: `Retry-After` headers ignored — fixed 500ms² backoff only; add header parsing when a provider throttles harder than generic backoff handles.

## 2026-10-30 — Provider: header/connect timeout (`headerTimeoutMs`, default 15s)

Context: the idle and total guards only start once response headers arrive. A host that accepts the TCP connection and never answers (the "provider OFF, spinner forever" report) hung the first `fetch` for minutes — before any retry, callback or guard had a chance to run, so nothing appeared on screen.

Decision: each attempt races a 15s time-to-headers timer via its own `AbortController` (merged with the turn's signal; timer cleared the moment headers arrive, so long streams are never killed by it). Expiry aborts the fetch with `no response within 15000ms (connect/headers timeout)`, which flows into the existing retry/backoff/display path. Constant, not config — same reasoning as the runaway caps.

Follow-up (same day): `send()` in the TUI (and the plain REPL) now `.catch`es `runTurn` into an `internal error: …` message — defense in depth, since `runTurn` already catches chat throws itself; anything thrown outside chat (store, prompt build) used to reject unhandled and leave the spinner stuck with nothing on screen. Verified the whole path against a real black-hole TCP server: 15s header timeout → visible retries → `no response within 15000ms (connect/headers timeout) (after 3 attempts)` at ~47s.

Second follow-up (same day): retries are now **infinite** by default — the user wants the turn to ride out an outage, watching each attempt, not die after 3. Backoff 1s doubling to a 30s cap; every retry fires `onRetry` (TUI shows `attempt N failed — … · retrying in Xs` above the context line, REPL prints it). `4xx` other than `429` is fatal and skips the loop (a bad key retrying forever is a bug, not resilience); abort still cuts the wait instantly. `maxRetries` exists only so tests stay finite. Delay formula moved from `500 * 2^(attempt-1)` to `min(1000 * 2^(attempt-2), 30_000)`.

Third follow-up (same day): backoff rescheduled per user preference — first retry waits 10s, doubling, 60s cap (`10s → 20s → 40s → 60s → 60s…`). `backoffBaseMs` added next to `maxRetries` so tests don't sleep real seconds. Trade-off accepted: the first 10s window shows only the previous attempt's failure line, no new feedback — matching "perto do working" rather than extra chatter.

## 2026-11-01 — Tool-round cap removed; the stream/MCP guards stay

Decision: `MAX_TOOL_ROUNDS` (50) is gone — a turn runs until the model stops calling tools; ctrl+c aborts is the only bound.
Why: the cap cut real work mid-task twice in production use (the user saw "turn was stopped after 50 tool rounds" mid-debug); a tool-heavy turn is legitimate, and the user watching the transcript IS the runaway detector. The 10min stream cap and the MCP pagination cap remain — they guard byte-drip/proxy hangs, not work volume.
Cost if wrong: a degenerate model looping tool calls forever bills tokens until the user hits ctrl+c. Re-add a cap (config-gated, default off) if that ever happens in practice.

## 2026-11-03 — Permission mode persists to the global config

Decision: `/permissions` (TUI) now saves the picked mode to `permissionMode` in the global config (`savePermissionMode` — merges keys, replaces a malformed file) and the TUI starts in `config.permissionMode` (default `normal`, invalid value warns and falls back). The pick always writes the global file, never the project's `lugent.json`; load is first-file-wins like `providers`, so a project `permissionMode` (e.g. `"yolo"`) overrides the saved global choice while present.
Why: the user wants yolo as a *saved choice*, not per-session state; but a repo must not be able to flip trust on or off silently by itself — hence global-only writes with project-side override allowed explicitly, mirroring the existing providers precedence.
Cost if wrong: a user who saves `yolo` globally forgets it and later opens an untrusted repo — every call auto-approves with no dialog (the red `YOLO` badge is the only signal). A per-project trust prompt would be the upgrade if that bites.
