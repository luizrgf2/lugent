# TUI layer

`src/cli/tui/` renders the full-screen interface (React + Ink v8); `src/cli/repl.ts` is the `--plain`/piped fallback. `src/main.ts` picks: TTY stdin+stdout → TUI, anything else → REPL. `runTui` erases the visible viewport (cursor-home + erase-down, scrollback preserved) before `render()` — ink only clears when a prior frame exists, so without it the first frame lands below the shell prompt. Shared prompt-building lives in `src/cli/context.ts` (`buildPromptInput`).

```
provider.chat (SSE)
  onReasoning(chunk) → TItem "reasoning" (dim italic; display-only, never stored)
  onToken(chunk)     → TItem "assistant" (markdown-lite: fences, `code`, **bold**, #h1-3, tables, lists — inline styles apply inside headings and list items too)
  onToolStart        → TItem "tool" (glyph + name + resource)
  onAsk              → Permissions dialogs, queued in order (parallel asks would race); y/n/a; Ctrl+C denies + aborts
```

Files: `app.tsx` (state + turn flow + `runTui`), `mouse.ts` (stdin proxy: strips SGR mouse reports before ink parses them, exposes wheel notches via `onWheel`, switches terminal modes 1000/1006 on and off around the session, and toggles them at runtime for `/mouse` — see `docs/decisions/cli-tui.md` 2026-11-01), `status.tsx` (`LogoMark`: the big L-mark raster + the block-letter `LUG`/`ENT` wordmark (5×5 glyphs, white/cyan split) beneath, centered, no border — rows and colors from the shared `src/cli/logo.ts` (SVG-exact gradient); its rendered height (`LOGO_HEIGHT` = raster rows + block wordmark + margin, currently 16) is subtracted from the transcript budget in `app.tsx` (`transcriptWindow`, alongside `frameRows`); on the empty screen `logoTopPad(rows)` adds blank rows above it so the logo opens in the vertical middle — 0 as soon as the transcript has an item, capped so pad + logo + chrome never exceed the terminal (see `docs/decisions/cli-tui.md` 2026-11-01); `ContextLine` doubles as the whole chrome bar — one blank row above it separates the transcript from the chrome (`CHROME_HEIGHT` = composer 3 + context 1 + retry 1 + that blank), left: `§ AGENTS.md loaded │ agent <id> │ YOLO │ OFF` with `│` separators, right: spinner + `working…` while busy and the `provider · model` always visible; `Status`/`Spinner` remain exported for legacy tests), `transcript.tsx` (`itemsFromHistory` maps stored messages back to TItems for `/resume` replay — reasoning is never persisted), `input.tsx` (refs mirror state — ink batches keys into one render, stale-closure hazard; optional `completions` prop renders a slash-command autocomplete box under the composer: prefix-filtered, `↑/↓` move, Tab completes), `permissions.tsx`, `model-picker.tsx` (`/model`: provider list → live `listModels()`, windowed 8 rows, pick updates provider+model state and appends a dim `system` line), `skill-list.tsx` (`/skills`: read-only windowed list of loaded skills), `agent-picker.tsx` (`/agent`: windowed agent list with descriptions; picking switches the profile and persists it via `store.setAgent`), `session-picker.tsx` (`/resume`: windowed session list scoped to the project directory; picking one switches session state, restores provider/model and replays `itemsFromHistory`), `permission-mode.tsx` (`/permissions`: normal/yolo toggle, yolo sets `runTurn(yolo)`), `markdown.ts` (pure parser), `harness.tsx` (test-only renderer).

Provider: `chat(args.onReasoning?)` forwards `delta.reasoning_content` chunks. Not accumulated into `content`, not persisted — replaying a session shows no reasoning (accepted).

Provider injection: `env.makeProvider?(cfg, model)` (tests); default `new Provider(cfg, model)`.

### Transcript windowing & scroll

Rendering stays O(viewport) regardless of history length — no item outside the window is ever rendered:

- **The frame is a fixed-height column** (`app.tsx`): the root `Box` is pinned to `frameRows(stdout.rows)` = `rows - 1`, the transcript region is the only `flexGrow` child (`flexShrink={1} minHeight={0}`, bottom-aligned, `overflowY="hidden"`), and the chrome below it is one `flexShrink={0}` block. Sizing the region from its content instead let a page of scroll (or a wrapped long line) change the frame height and shift the composer up and down — reported as "the input moves while I scroll". `Transcript` and each item also carry `flexShrink={0}`, or Yoga shrinks a tall item and slices it mid-row.
  - One row is left free at the bottom (`frameRows`) on purpose: a frame as tall as the viewport is *fullscreen* to ink, which switches to the full-clear erase path between frames and wipes the frame on exit. Pinned to `rows` exactly, quitting erases the conversation.
  - `clampItems` counts lines with `split("\n")` — **logical** lines. A long line that the terminal soft-wraps occupies several rows while counting as one, so the window must be the clipped, fixed height above rather than the sum of the item heights; that is what keeps a wrapped answer from overflowing the terminal.
- `clampItems(items, maxLines, skipBottom)` walks items newest→oldest, line-budgeted. `skipBottom` scrolls up: it hides the newest N lines and shows the window just above (a straddling multi-line item is sliced from the top). `itemLines` = `split("\n").length` for **every** kind — reasoning/system/user render raw newlines as real rows too, and under-counting them overflowed the window and scrolled history off the screen. Oversized non-assistant items are tailed (last lines kept) like assistant ones.
- `App` holds `scroll`/`scrollRef` (ref mirrors state — ink batching hazard). PageUp adds the page budget, PageDown subtracts (clamped at 0 = follow tail). Submit resets to 0. Keyboards without page keys: Shift+↑/↓ page up/down, Home jumps to the top (oversized `scroll` clamps to the head window), End returns to the tail. The mouse wheel (three lines per notch) comes from `mouse.ts` via the `onWheel` prop and is ignored while an overlay or permission dialog owns the input.
- **View pin while scrolled up**: streaming callbacks go through `grow()`, which counts tail-item line deltas (`seen`) and bumps `scroll` by the same delta — new content grows below without jumping the screen. `seen` always tracks (not only when scrolled) so a mid-stream PageUp doesn't miscount.
- **Parse cost**: `parseMarkdown` is an LRU (300 entries) keyed by text — streaming re-parses of the growing prefix collapse to Map lookups; `Markdown` is `memo`ized so stable items don't re-render. `clampItems` line counting avoids `parseMarkdown` entirely (plain `split`).

---

Index: [`docs/architecture.md`](../architecture.md)
