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

## 2026-11-03 — Permission-mode save failure is warn + session-only; `permissionMode` stays required on `AppConfig`

Context: the audit of the persistence work (issue #9) left two calls open. (1) When `savePermissionMode` cannot write (e.g. `EACCES` on a read-only `~/.config/lugent`), should the pick still apply? (2) `AppConfig.permissionMode` is required on the exported interface, which breaks out-of-tree config-object literals — keep, optional, or add a `tsc --noEmit` gate?

Decision: (1) a failed save **warns and keeps the mode for the session only** — `savePermissionMode` returns `false`, `console.warn` fires (the repo's loader convention), and the transcript notes `… — save failed, session only`. Not blocking: blocking yolo entry on writability punishes locked-down hosts for a trust setting the session guard still enforces everywhere else; the red `YOLO` badge keeps the session state visible, and the warning names the path so the cause is diagnosable. Not retrying: a persistent `EACCES` cannot be fixed by retrying and an alternate-path prompt is UX complexity for a rare failure. (2) **`permissionMode` stays required.** `loadConfig()` always populates the field (default `normal`), so the only way to observe `undefined` is an out-of-tree literal that skipped loading — exactly the object the field exists to constrain; making it optional would push `undefined` handling onto every `=== "yolo"` reader for a hypothetical consumer. No `typecheck` script is added — this repo deliberately ships none, and `tsc --noEmit` flags ~20 pre-existing strictness findings unrelated to this change; adopting a gate is its own decision, not a rider on this one.
Why: the session-only policy matches how every other recoverable config problem in the repo behaves (warn and continue), and the required field is the honest contract — there is no meaningful default for "the user never expressed a trust preference" other than `normal`, which `loadConfig()` already supplies.
Cost if wrong: if session-only proves too lax, the upgrade path is blocking yolo entry when the save fails — additive, no API change. If external literal builders materialize and hurt, making the field optional is a one-line, non-breaking relaxation (readers already handle only `=== "yolo"`).

## 2026-11-03 — Rate limit recovers by exponential-backoff retry, not a circuit breaker

Context: issue #7 asked for a decision (retry vs circuit breaker) said to be about PR #1. That PR is a fully static landing page — no fetches, no API calls — and its audited head SHA does not exist in the repo (the audit payload carried the all-zero placeholder), so the question has no code behind it on that branch. The real rate-limit handling lives in `Provider.chat` (`src/core/provider.ts`): 429/5xx enter the retry loop (10s base, doubling, 60s cap, retries indefinite by user choice since 2026-10-30, other 4xx fatal), with `onRetry` surfaced in both UIs.

Decision: **exponential-backoff retry stays; no circuit breaker.** A circuit breaker protects callers that keep hammering an unhealthy endpoint automatically — but lugent is a single-user, single-turn client where every retry is visible (`attempt N failed — retrying in Xs`) and ESC/ctrl+c aborts instantly. The user *is* the circuit breaker, with better judgment than any threshold. A breaker would add state (open/half-open/closed), tuning knobs and flapping failure modes to a process that lives and dies with one session. `Retry-After` header parsing remains the ponytail from 2026-10-30: it refines the wait length without changing the strategy.
Why: retries handle transient 429s (the common case with local routers and rate-limited gateways); sustained outages are handled by the human watching the transcript, not by more machinery.
Cost if wrong: a headless/automated caller looping turns against a throttled endpoint would bill repeated 10s→60s waits with no tripping. If lugent ever grows a non-interactive batch mode, that is the trigger to revisit a breaker.

## 2026-11-03 — session preview is local heuristics, not LLM-generated
Decision: `/resume` previews are distilled locally (`sessionPreview()` in `store.ts`): first significant prose line of the first user message, whitespace collapsed, markdown chrome (fences/bullets/headings) skipped, 96-char cap. No LLM call.
Why: zero deps in core, zero latency, zero cost; the REPL truncates to 48 chars anyway, so model-quality titles add nothing visible.
Cost if wrong: sessions whose first message is pure data (logs with no prose) get a mediocre summary — trigger to revisit: an LLM title cache column + provider hook, opt-in.

## 2026-11-03 — session order is last-message time, computed at query time
Decision: `listSessions()` orders by `COALESCE(MAX(message.created_at), session.created_at) DESC` with an `(session_id, created_at)` index; no denormalized `updated_at` column.
Why: no schema migration, no write-path change; local single-user scale makes the indexed MAX cheap, and `updatedAt` also surfaces in the summary for display.
Cost if wrong: listing cost grows with per-session message count on huge DBs — escape hatch is adding the column + trigger later, query shape stays.

## 2026-11-11 — A provider form writes the global config through `saveProvider`

Context: adding a provider meant hand-editing `~/.config/lugent/config.json` and guessing the JSON shape. `/add-provider` automates that edit — but an automated writer of a file that holds credentials and the user's whole configuration needs its rules stated once, not implied by UI code.

Decision: one pure persist function, `saveProvider(name, cfg, path = globalConfigPath())`, sibling of `savePermissionMode`. (1) **Merge-preserving write** — read-modify-write, every other key survives (`permissionMode`, `mcp`, `defaultProvider`, other providers); an unparseable file is replaced, exactly as `savePermissionMode` already does. (2) **Global only** — the function never takes a `projectRoot`; a repo must not be able to carry or rewrite credentials. (3) **`0600` when the entry holds an inline key**, the same rule the MCP OAuth token store applies; a `{env:VAR}` reference is not a secret, but the file may hold one, so the mode is set whenever a non-empty key lands. (4) **Trailing slashes are stripped on save**, not only in Test: `Provider` concatenates `baseUrl` raw, so a test-only fix would produce the worst case — Test passes, the config keeps the slash, and every later chat 404s. `Provider` itself is left untouched; normalizing there would change behavior for hand-written configs and needs its own tests. (5) **An empty key field keeps the stored `apiKey`** — re-running the form is the only refresh path, and writing `""` would silently destroy a working key; `models`, when the form hands one over, replaces the cached list wholesale. (6) **The cached `models` list is authoritative** — `/model` reads it when present and only calls `listModels()` when absent, so a provider whose endpoint is briefly down still lists its models; re-running `/add-provider` is the refresh. (7) **`defaultProvider` is deliberately untouched** — the form only adds; switching stays in `/model`.

Why: the value of the feature is doing *the existing edit* correctly once, so the write path is one tested function rather than logic smeared across two front ends. A form that invented a new secret format would break every hand-written `{env:VAR}` entry; a form that wrote a project `lugent.json` would shadow the global file it was asked to fill.

Cost if wrong: (3) is a permission change to a file the user owns — someone with a `0664` config who relies on group read access loses it after one save; the escape is `{env:VAR}`, which is not written into the mode decision. (5) means a user who *intends* to clear a key cannot do it from the form — they edit the file. (7) leaves the known rough edge that a first-run user with an empty config still has no provider selected after adding their only one; `/model` fixes it in one step, and choosing a default is the decision deliberately left out of this scope.

## 2026-11-11 — `saveProvider` returns the live-session entry; only the file keeps `{env:VAR}`

Decision: `saveProvider` returns `{ ok, error?, live }`. `live` is the entry both front ends push into `env.config.providers[name]`: `baseUrl` normalized, `models` exactly as written, and `apiKey` already run through `subEnv()`. A reference that resolves to nothing is omitted from `live` entirely. The file keeps the reference untouched.

Why: `Provider.headers()` sends `cfg.apiKey` verbatim and never substitutes, which is safe only for entries that came out of `loadConfig`. The form is the first writer of a raw typed key into `env.config.providers`, so pushing the typed string makes the session send a literal `Bearer {env:VAR}` on every turn until restart — Test passes, the file is correct, and the session 401s. Building the session entry by hand in two front ends is precisely how the two drift; the first implementation did exactly that and shipped the bug in both.

Cost if wrong: file and session now differ by design on the key (and only the key); a caller that wants the literal reference must read the file or `loadConfig`, not `live`. An unresolved reference now yields a session entry with *no* key rather than a malformed `Bearer `, so the diagnostic has to come from Test's explicit "environment variable NAME is not set" — a deliberate trade against an empty-token header that gateways answer with a less useful error.

## 2026-11-11 — A models-less re-run keeps the cached list, and says so

Context: spec decision 6 offers to save a provider **without** a `models` key when the endpoint answers `200` and advertises nothing, and said `models` is therefore optional in `saveProvider`. For a name that does not exist yet that is literal and correct. For a name that **already has a cached list** the same call collides with `saveProvider`'s retention rule (`models === undefined` keeps what the file holds) — the first implementation then described the save two ways that were both false: the confirm claimed "it keeps no model list" while the file kept it, and the transcript reported `N models imported` by counting the retained list.

Decision: the retention wins, and every string says so. `saveProvider` is unchanged (`models` present → replace; absent → keep). The confirm for an existing name reads *keeps its current model list (the endpoint advertised none this time)*; the result line distinguishes three cases from what the form actually handed over — `N models imported` (a real import), `saved · model list unchanged (N kept, …)`, or `saved with no model list` for a brand-new provider. `models` being optional in `saveProvider` still means what decision 6 needs (a new provider can be saved with no list), it just no longer implies "drop the old one".

Why: decision 5 makes the cache authoritative precisely so a provider whose endpoint is briefly down still lists its models. A `200 {"data":[]}` from a gateway mid-restart is the same transient as being down, so dropping a working list there destroys the data decision 5 exists to protect — and it would do it silently on `enter`, from a form whose whole job is to not damage a working config. Counting what the form handed over (not `saved.live.models`) is what keeps the two messages true: `live` mirrors the file, so it cannot tell an import from a retention.

Cost if wrong: a user who genuinely wants the list gone cannot get it from the form — same escape hatch decision 5 already documents (`{env:VAR}` for the key, hand-edit for the list). Re-running against a healthy endpoint re-imports and replaces the list, which is the refresh path.

## 2026-11-11 — `noModels` is set by any `2xx` that yields no model ids, JSON or not

Context: spec decision 6 says a `200` with an *empty or unparsable* list is reported as "endpoint answered but advertised no models", because non-JSON bodies throw inside `res.json()`. The first implementation returned `{ error: "response is not JSON" }` without `noModels` — the plan's Task 2 step text said so — so a gateway behind a login page, a wrong path or a proxy error page answered `200 text/html`, the form printed a Test failure and told the user to retest a url that had just answered, and the models-less save was unreachable. Docs claimed the opposite, and the HTML test only asserted `ok === false`, which is how it survived three rounds.

Decision: `discoverModels` treats an unparsable `2xx` body exactly like `{"data":[]}` — `ok: false`, `noModels: true`, error "endpoint answered but advertised no models". The line is drawn at the status code, not the body: any non-`2xx` (401, 404, 5xx) stays a hard failure with no `noModels`, because there is nothing to save against an endpoint that refused.

Why: for the form's only purpose — "can I save this provider and is there a list to import?" — a login page and a gateway with no models are the same answer, and the form cannot tell them apart. Decision 6 chose the recoverable reading for the whole class; picking `2xx` as the boundary keeps a bad key or a dead host on the retest path (which the key and url walk-back now make cheap) while never trapping the user in front of a working url.

Cost if wrong: a user who pastes a base url pointing at a non-API page gets a saved provider with no model list instead of an error, and only finds out when `/model` falls back to a live call that also returns nothing. That is a recoverable state (the provider entry is editable, and re-running the form replaces it), whereas the alternative — reporting a reachable endpoint as a failed Test — strands the form with no offer at all.
