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

Decision: `mouse.ts` wraps `process.stdin` in a queue-backed stream handed to `render({ stdin })`. It strips all SGR mouse reports (`ESC[<…M/m`) before ink's parser sees them, switches modes 1000+1006 on around the TUI session and off on exit, and surfaces wheel notches (−1/+1) on a side channel that `App` maps to 3 lines of transcript scroll. `runTui` accepts an `io` override for tests and passes a `setMouse` callback so `/mouse` can toggle tracking mid-session (`MouseStdin.set(on, stream)` writes the pair and gates the deltas).

Why: ink has no mouse handling at all — a wheel report reaches `useInput` as garbage text (ESC stripped), so the transcript never moves and the wheel looks broken. Two sub-decisions came out of the ink internals: (a) the proxy is a queue with `read()`, not a PassThrough, because ink drains with `while (stdin.read())` and PassThrough coalesces writes in the same tick into one chunk, which parses as text — a `\r` glued to "go" never becomes Return; (b) `setEncoding` must stay the proxy's own (mirroring it to the source leaves Buffers, which the input parser silently drops).

Cost if wrong: any terminal that ignores 1000/1006 gets no wheel scrolling (keyboard scroll still works — shift+arrows, Home/End, PageUp/PageDown); a terminal that emits mouse reports in the legacy X10 encoding is not handled, so those reports would reach ink as junk. Also, mouse reporting must be restored on every exit path — `process.on("exit")` covers crashes, but a `SIGKILL` leaves the user's shell with 1000/1006 enabled (text selection swallowed) until `reset`.

## 2026-11-01 — `/mouse` opts into the wheel; text selection is the default

Decision: terminal mouse tracking (1000 + 1006) starts **off** and `/mouse` turns it on for the session. While off, `MouseStdin` ignores wheel deltas (a report that arrives anyway is dropped, never parsed into a scroll); while on, notches scroll three lines and click-drag goes to the app. `MouseStdin.set(on, stream)` writes the pair to the stream the caller owns, and `runTui` starts it off and always writes `MOUSE_OFF` on the way out. A transcript `system` line reports which mode is active; nothing re-renders (the state is a ref) and nothing is persisted.

Why: tracking and the terminal's own click-drag selection are mutually exclusive — with 1000 active the terminal routes the drag to the application, which has no hit-testing and drops it, so the transcript cannot be selected or copied. Copying has no substitute here: lugent ships no clipboard helper (no `wl-copy`/`xclip`/`xsel`/`pbcopy` — `docs/decisions/cli-tui.md` 2026-10-24 already records this for the OAuth URL), while scrolling has a complete keyboard equivalent (PageUp/PageDown, shift+↑/↓, Home/End, all 7 lines per page — see the fixed-height frame decision). Breaking the only copy path by default to save one keystroke on a path with a working alternative is the wrong default. The original "on by default" choice had this backwards: it treated the wheel as the primary affordance and selection as the mode, when the terminal's selection is the one that has no fallback.

Cost if wrong: the wheel no longer works until the user runs `/mouse` — a discoverability cost paid once, and the `/` autocomplete lists the command. The toggle is session-scoped, so a wheel-first user re-runs it on every start; if that becomes the common complaint, the fix is a config key (e.g. `"mouse": "wheel"`) rather than flipping the default back. `enabled` also has to stay false-safe: were it to default true again without the terminal being told, reports would arrive that the app ignores, which looks like a dead wheel rather than a broken selection.

## 2026-11-01 — The logo opens centered by padding the splash, not by centering the layout

Decision: while the transcript is empty, `App` passes `logoTopPad(rows)` blank rows to `<LogoMark topPad>` as `marginTop`, and subtracts the same pad from the transcript window budget. The pad is half the slack left by the logo (`(rows - LOGO_HEIGHT) / 2`), capped at `rows - LOGO_HEIGHT - CHROME_HEIGHT`, and drops to 0 on the first transcript item — the mark then docks to the top for the rest of the session. `logoTopPad` and `CHROME_HEIGHT` live in `src/cli/logo.ts` next to `LOGO_HEIGHT` so the window budget and the pad cannot disagree.

Why: the mark hung off the top because the layout is a plain `flexDirection="column"` — ink has no vertical centering and the rows below it are content-sized, so the logo block sits at row 0. A pad is the only knob that keeps the frame's real height honest: `height="100%"` resolves to auto in ink, so the transcript window is manually clamped from `stdout.rows` anyway, and any pad that is not subtracted there pushes the composer off the screen and paints the logo into scrollback. Padding only while empty keeps the "splash" reading — a permanently centered logo would waste 10+ rows for the whole session. The cap matters on short terminals: with `logoTopPad` unbounded, a 20-row terminal would pad to 4 and overflow.

Cost if wrong: the logo visibly jumps from the middle to the top on the first message (intended, but it is a layout shift a user may read as a bug); the pad is derived from `stdout.rows` read during render, so a resize mid-splash recenters on the next frame but a terminal that reports `rows` late (or 0) gets no padding rather than a broken frame. The centering is vertical only — horizontal centering is still ink's `alignItems="center"`, unchanged.

## 2026-11-01 — The wordmark is block letters, so the logo grew to 16 rows

Decision: "LUGENT" is rasterized as five rows of 5×5 glyphs (`WORDMARK_ROWS` in `src/cli/logo.ts`, one space between letters, 35 columns) instead of a single bold text line, with `WORDMARK_SPLIT` marking where the white `LUG` hands off to the cyan `ENT`. `LOGO_HEIGHT` becomes `LOGO_ROWS + WORDMARK_ROWS + 1` = 16.

Why: a one-line wordmark reads as a caption under a mark that is ten rows tall — the name was the smallest part of its own splash. Block letters make the name the subject without touching the mark or the gradient. Deriving `LOGO_HEIGHT` from `WORDMARK_ROWS.length` (not a new literal) keeps it correct if a glyph row is ever added.

Cost if wrong: the splash is 4 rows taller, so the transcript window loses 4 rows of budget (13 → 9 on a 30-row terminal) and PageUp/PageDown move 9 lines instead of 12; the two existing tests that pinned 12/9 encoded that coupling and were updated with the numbers they now guard. On a terminal under ~21 rows `logoTopPad` returns 0 and the splash loses its centering, which is the same graceful degradation as before, just reached sooner.

## 2026-11-01 — A blank row separates the transcript from the chrome

Decision: `ContextLine` gets `marginTop={1}` and `CHROME_HEIGHT` goes 5 → 6 (composer 3 + context 1 + retry 1 + blank 1). The blank is charged to the transcript window budget like any other chrome row.

Why: the context line is always on screen (that is the point of it), so the last transcript line sat flush against `§ AGENTS.md loaded │ agent build` and an answer read as the status bar's first row. Every other boundary in the transcript already has a row (items get `marginTop={1}`); the chrome was the one place the mark and the text ran together.

Cost if wrong: the transcript loses one more row of budget (9 → 8 on a 30-row terminal, one PageUp is 8 lines) — the same trade as the wordmark, and the same tests carry the numbers. If the padding reads as a gap on a very short terminal it degrades with the rest of the splash (pad 0), never as an overflow.

## 2026-11-01 — The frame is a fixed-height column; the transcript is what gives

Decision: `App`'s root `Box` is pinned to `frameRows(stdout.rows)` = `rows - 1`, with the transcript as the only flexible child (`flexGrow={1} flexShrink={1} minHeight={0}`, bottom-aligned, `overflowY="hidden"`) and everything below it (retry line, `ContextLine`, overlay/input) in a single `flexShrink={0}` block. `Transcript` and each item also get `flexShrink={0}`. The window budget is `transcriptWindow(rows, pad) = frameRows(rows) - CHROME_HEIGHT - LOGO_HEIGHT - pad`, shared by the region's height and the PageUp/PageDown step; both live in `src/cli/logo.ts` next to the constants they derive from.

Why: the region used to be content-sized, so the frame height was a function of the transcript — one PageUp grew the frame by a row and pushed the composer down, and a wrapped long line (one logical line, several terminal rows) pushed the whole frame past the terminal (39 rows on a 30-row screen, composer off-screen). Reported as "the input moves while I scroll". Pinning the frame makes the chrome immovable by construction instead of by arithmetic that has to agree with `itemLines` about wrapping, which it cannot. `frameRows` leaves the last row free deliberately: ink treats a frame `>= viewportRows` as fullscreen, switches to the full-clear erase path and wipes the frame on unmount — measured: pinned to `rows` exactly, quitting erased the conversation; at `rows - 1` the exit writes no erase at all. `overflowY="hidden"` is what keeps a wrapped item from spilling below the window; `flexShrink={0}` on the items stops Yoga from shrinking and slicing a tall one mid-row.

Cost if wrong: one row of budget is spent (8 → 7 lines on a 30-row terminal, so a page scroll is 7 lines and two tests carry the new numbers) and the terminal's last row stays blank while the TUI is up. The overlays (`/model`, `/skills`, …) are still sized below the composer and are not clipped by it — a picker taller than the window eats into the transcript region, which is the intended trade (the picker is modal, the transcript is not). If ink ever changes what counts as fullscreen, `frameRows` should be revisited together with the `rows - 1` tests in `app.test.tsx`.

## 2026-11-02 — History belongs to the terminal scrollback; /mouse and wheel tracking are gone

Decision: when a turn finishes, `App` commits its items to ink `<Static>` — ink prints each new item once, above the frame, into the terminal's own scrollback — and the live frame renders only the current turn. `mouse.ts`, the stdin wheel proxy, terminal modes 1000/1006 and the `/mouse` command were deleted; lugent never enables mouse tracking.

Why: scrolling the conversation had to work with the plain wheel, no command, no opt-in — the wheel/selection mutual exclusion made every default wrong (tracking on breaks selection, tracking off makes the wheel dead). Once history is in scrollback, the terminal scrolls it natively: wheel, click-drag, touchpad, search — all free, and text selection (the only copy path) always works. The frame keeps PageUp/PageDown/Shift+arrows/Home/End and the mid-stream view pin for the current turn only, which is the one thing scrollback cannot reach.

Cost if wrong: `<Static>` items are write-once — a turn is committed once and never re-rendered, so any future "edit/collapse an old message" needs a different mechanism; the frame shows only the live turn, so a turn taller than the window still loses its head to clipping while streaming (recoverable with PageUp mid-turn, and the committed copy in scrollback is complete). The commit snapshots `liveRef` before the `setItems` updater because updaters run lazily — reading the ref inside them sees the emptied ref and drops the turn (caught by the "exactly once" test). Keys typed in the same tick a turn ends may still hit the disabled composer (pre-existing input.tsx behavior).

## 2026-11-02 — The logo prints once to the scrollback; the frame never carries it again

Decision: `items[0]` is always a `logo` TItem; ink `<Static>` prints it once at the top of the conversation, above the first turn. `<LogoMark>` renders in the live frame only while nothing has been said (the splash, centered by `logoTopPad`), and `<Static>` itself is mounted only once the conversation starts — the two states are mutually exclusive, so the logo is never printed twice. `transcriptWindow` no longer subtracts `LOGO_HEIGHT` (the live window grew from 7 to 23 lines on 30 rows — that is now the PageUp page too); the splash budget moved to `splashWindow`. `/resume` appends the replayed history instead of replacing the list.

Why: the logo used to live inside the fixed-height frame, so it re-rendered between the `<Static>` history above and every new turn below — permanently mid-conversation ("as the conversation grows the logo keeps appearing in the middle"). With history in the terminal's own scrollback (2026-11-02), the only correct place for a once-only visual is the scrollback itself, above turn 1. `<Static>` is append-only (its internal index only grows and lines already handed to the terminal cannot be taken back), which is why seeding the logo as item 0 and appending everywhere — including `/resume`, which used to replace the array and would have orphaned the printed lines — is the shape that cannot misbehave.

Cost if wrong: the transcript window doubled-plus, so the scroll tests carry new numbers and the mid-stream pin test now asserts a stable head instead of byte-identical windows (a wider window legitimately shows new lines growing under the pin). A `/resume` re-print of a session means the earlier copy stays in scrollback above the replay — accepted: scrollback is write-once, and the alternative (replacing items) desynchronizes ink's static index from what the terminal shows. Follow-up (same day): with the logo gone from the frame, an idle frame pinned to `frameRows` put `rows - CHROME_HEIGHT` blank rows between the last scrollback'd message and the composer — the idle frame now shrinks to the chrome (`CHROME_HEIGHT`) whenever no turn runs, no overlay/dialog is open and the live transcript is empty; a full-height column is reserved for the busy states. Idle-to-busy resizing is one ink commit (bottom-anchored), invisible in practice.

## 2026-11-03 — a manual /model switch is written to the session row; /resume restores the last choice

Decision: every manual model switch (`/model` picker in the TUI, `/model <provider> [model]` in the REPL) calls `store.setModel(sessionId, provider, model)`, updating the session row's `provider`/`model` in place. `/resume` restores both fields from the row (it used to restore only the model — the provider stayed whatever the current session had, pairing a foreign model with the wrong endpoint). `/clear` creates the new session with the current provider, not the config default. A configured agent's own model still wins over the row on resume (`agentModelTarget`, unchanged).
Why: the session row already carried `provider`/`model` from creation time, but the pick lived only in memory — leave mid-session on deepseek, come back, and /resume silently put you back on the creation default. Pinning the choice to the row makes "the session remembers" true by construction and costs one UPDATE per explicit switch (never per turn).
Cost if wrong: a switch that turns out unwanted is remembered too — the fix is one more `/model`, not config surgery. Legacy rows keep their creation-time values, which was the old behavior anyway. If per-agent model overrides and manual picks start fighting in practice (agent wins on resume even after a manual pick), the trigger is a "manual pick sticks over agent" row in the precedence chain, not a schema change.

---

Index: [`docs/decisions.md`](../decisions.md) — one file per area, chronological within each.
