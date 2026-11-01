# Decisions — CLI & TUI

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

## 2026-10-22 — TUI v1: deliberate deferrals from final review
Decision: ship the Ink TUI without (a) deduplicating reasoning across loop iterations, (b) case-insensitive/word answers in permission dialogs, (c) alt-screen mode.
Why: all three are cosmetic edge paths (reasoning repeats only when the model reasons after a tool result; the REPL already accepts `yes`/`always` and caps; scrollback pollution on exit is minor). None blocks the core flow, and each risks touching the just-stabilized input/permission plumbing.
Cost if wrong: minor UX roughness until addressed; revisit when (a) a model streams reasoning mid-tool-loop regularly, (b) users complain about capital Y, (c) scrollback complaints start.

## 2026-10-23 — /resume is scoped by directory; legacy sessions excluded
Decision: sessions store their working directory; `/resume` lists only sessions of the current directory and skips rows created before the column existed (null directory).
Why: cross-directory resumes mix unrelated projects' context and permissions; a null-directory fallback would flood the picker with unscoped legacy rows.
Cost if wrong: databases from before this change never become resumable — acceptable one-time loss; upgrade path is backfilling directory from message metadata if ever needed.

## 2026-10-23 — TUI transcript scroll is tail-clamped window + skipBottom, not per-item virtualization
Decision: transcript keeps rendering only a manual window (`clampItems(items, budget, skipBottom)`); PageUp/PageDown move `skipBottom`, streaming growth is compensated by the same delta while scrolled up (view pin), submit snaps to tail. Markdown parse is LRU-cached (300 entries) and the `Markdown` component is `memo`ized. (Amended: a skip that would swallow the whole transcript — pageUp pressed early in a long stream, where the pin compensation outgrows the item — falls back to the head window, so the view is never blank and the oldest lines stay reachable.)
Why: opencode-style per-item virtualization needs stable item ids + measured heights; ink has neither cheaply. Line-based clamping reuses the existing tail-clamp, renders O(viewport) regardless of history size, and the parse cache removes the O(n²) streaming re-parse.
Cost if wrong: cache misses on straddled slices (clamped texts differ per scroll position) re-parse — bounded by the 300-entry LRU; no arbitrary anchor (scroll is page-quantized only).

## 2026-10-24 — The consent URL is rendered outside the `/mcp` box, on one logical line

Decision: in the TUI picker the pending consent URL is a sibling *below* the bordered box (a wrapper `Box alignItems="flex-start"` holds the bordered panel with `width="100%"` plus the URL in an explicit huge-width, `flexShrink={0}` box with `Text wrap="truncate"`); it is never a child of the border. The REPL already prints it with `console.log` (no box).

Why: the URL is ~300 chars, so ink hard-wraps it at the container width and draws `│` on every visual line — copying the block yields a URL salted with border characters and mid-token newlines (observed live: `…%3` / `│ A48762…`). Outside the border, with a width the URL always fits, ink emits it as a single logical line and the terminal soft-wraps it for display only; terminals join soft wraps when copying, so the pasted URL is intact. A clipboard helper was rejected as the primary mechanism: it is absent on the machine this was reported from (no `wl-copy`/`xclip`/`xsel`/`pbcopy`) and would add a dependency-shaped code path for a fallback-only affordance.

Cost if wrong: the URL line visibly overflows past the panel's right edge on narrow terminals (accepted: readability of the box beats a URL you cannot copy), and the `width={100000}` + `wrap="truncate"` combination is load-bearing ink trivia — if ink changes how it measures oversized text, the URL truncates instead of overflowing, which the regression test in `mcp-list.test.tsx` catches by asserting the whole URL sits on one line with no `│`.

## 2026-11-01 — Mouse wheel scroll goes through a stdin proxy, not ink

Decision: `mouse.ts` wraps `process.stdin` in a queue-backed stream handed to `render({ stdin })`. It strips all SGR mouse reports (`ESC[<…M/m`) before ink's parser sees them, switches modes 1000+1006 on around the TUI session and off on exit, and surfaces wheel notches (−1/+1) on a side channel that `App` maps to 3 lines of transcript scroll. `runTui` accepts an `io` override for tests.

Why: ink has no mouse handling at all — a wheel report reaches `useInput` as garbage text (ESC stripped), so the transcript never moves and the wheel looks broken. Two sub-decisions came out of the ink internals: (a) the proxy is a queue with `read()`, not a PassThrough, because ink drains with `while (stdin.read())` and PassThrough coalesces writes in the same tick into one chunk, which parses as text — a `\r` glued to "go" never becomes Return; (b) `setEncoding` must stay the proxy's own (mirroring it to the source leaves Buffers, which the input parser silently drops).

Cost if wrong: any terminal that ignores 1000/1006 gets no wheel scrolling (keyboard scroll still works — shift+arrows, Home/End, PageUp/PageDown); a terminal that emits mouse reports in the legacy X10 encoding is not handled, so those reports would reach ink as junk. Also, mouse reporting must be restored on every exit path — `process.on("exit")` covers crashes, but a `SIGKILL` leaves the user's shell with 1000/1006 enabled (text selection swallowed) until `reset`.

## 2026-11-01 — The logo opens centered by padding the splash, not by centering the layout

Decision: while the transcript is empty, `App` passes `logoTopPad(rows)` blank rows to `<LogoMark topPad>` as `marginTop`, and subtracts the same pad from the transcript window budget. The pad is half the slack left by the logo (`(rows - LOGO_HEIGHT) / 2`), capped at `rows - LOGO_HEIGHT - CHROME_HEIGHT`, and drops to 0 on the first transcript item — the mark then docks to the top for the rest of the session. `logoTopPad` and `CHROME_HEIGHT` live in `src/cli/logo.ts` next to `LOGO_HEIGHT` so the window budget and the pad cannot disagree.

Why: the mark hung off the top because the layout is a plain `flexDirection="column"` — ink has no vertical centering and the rows below it are content-sized, so the logo block sits at row 0. A pad is the only knob that keeps the frame's real height honest: `height="100%"` resolves to auto in ink, so the transcript window is manually clamped from `stdout.rows` anyway, and any pad that is not subtracted there pushes the composer off the screen and paints the logo into scrollback. Padding only while empty keeps the "splash" reading — a permanently centered logo would waste 10+ rows for the whole session. The cap matters on short terminals: with `logoTopPad` unbounded, a 20-row terminal would pad to 4 and overflow.

Cost if wrong: the logo visibly jumps from the middle to the top on the first message (intended, but it is a layout shift a user may read as a bug); the pad is derived from `stdout.rows` read during render, so a resize mid-splash recenters on the next frame but a terminal that reports `rows` late (or 0) gets no padding rather than a broken frame. The centering is vertical only — horizontal centering is still ink's `alignItems="center"`, unchanged.

## 2026-11-01 — The wordmark is block letters, so the logo grew to 16 rows

Decision: "LUGENT" is rasterized as five rows of 5×5 glyphs (`WORDMARK_ROWS` in `src/cli/logo.ts`, one space between letters, 35 columns) instead of a single bold text line, with `WORDMARK_SPLIT` marking where the white `LUG` hands off to the cyan `ENT`. `LOGO_HEIGHT` becomes `LOGO_ROWS + WORDMARK_ROWS + 1` = 16.

Why: a one-line wordmark reads as a caption under a mark that is ten rows tall — the name was the smallest part of its own splash. Block letters make the name the subject without touching the mark or the gradient. Deriving `LOGO_HEIGHT` from `WORDMARK_ROWS.length` (not a new literal) keeps it correct if a glyph row is ever added.

Cost if wrong: the splash is 4 rows taller, so the transcript window loses 4 rows of budget (13 → 9 on a 30-row terminal) and PageUp/PageDown move 9 lines instead of 12; the two existing tests that pinned 12/9 encoded that coupling and were updated with the numbers they now guard. On a terminal under ~21 rows `logoTopPad` returns 0 and the splash loses its centering, which is the same graceful degradation as before, just reached sooner.

---

Index: [`docs/decisions.md`](../decisions.md) — one file per area, chronological within each.
