# TUI layer

`src/cli/tui/` renders the full-screen interface (React + Ink v8); `src/cli/repl.ts` is the `--plain`/piped fallback. `src/main.ts` picks: TTY stdin+stdout → TUI, anything else → REPL. Shared prompt-building lives in `src/cli/context.ts` (`buildPromptInput`).

```
provider.chat (SSE)
  onReasoning(chunk) → TItem "reasoning" (dim italic; display-only, never stored)
  onToken(chunk)     → TItem "assistant" (markdown-lite: fences, `code`, **bold**, #h1-3, tables, lists — inline styles apply inside headings and list items too)
  onToolStart        → TItem "tool" (glyph + name + resource)
  onAsk              → Permissions dialogs, queued in order (parallel asks would race); y/n/a; Ctrl+C denies + aborts
```

Files: `app.tsx` (state + turn flow + `runTui`), `status.tsx` (bar; shows provider/model/session/YOLO, plus the agent id — always set: `build` by default; also `LogoMark`: the big L-mark raster above the box — rows and colors from the shared `src/cli/logo.ts` (SVG-exact gradient), outside any border; its 10 rows are subtracted from the transcript budget in `app.tsx`), `transcript.tsx` (`itemsFromHistory` maps stored messages back to TItems for `/resume` replay — reasoning is never persisted), `input.tsx` (refs mirror state — ink batches keys into one render, stale-closure hazard; optional `completions` prop renders a slash-command autocomplete box under the composer: prefix-filtered, `↑/↓` move, Tab completes), `permissions.tsx`, `model-picker.tsx` (`/model`: provider list → live `listModels()`, windowed 8 rows, pick updates provider+model state and appends a dim `system` line), `skill-list.tsx` (`/skills`: read-only windowed list of loaded skills), `agent-picker.tsx` (`/agent`: windowed agent list with descriptions; picking switches the profile and persists it via `store.setAgent`), `session-picker.tsx` (`/resume`: windowed session list scoped to the project directory; picking one switches session state, restores provider/model and replays `itemsFromHistory`), `permission-mode.tsx` (`/permissions`: normal/yolo toggle, yolo sets `runTurn(yolo)`), `markdown.ts` (pure parser), `harness.tsx` (test-only renderer).

Provider: `chat(args.onReasoning?)` forwards `delta.reasoning_content` chunks. Not accumulated into `content`, not persisted — replaying a session shows no reasoning (accepted).

Provider injection: `env.makeProvider?(cfg, model)` (tests); default `new Provider(cfg, model)`.

### Transcript windowing & scroll

Rendering stays O(viewport) regardless of history length — no item outside the window is ever rendered:

- `clampItems(items, maxLines, skipBottom)` walks items newest→oldest, line-budgeted. `skipBottom` scrolls up: it hides the newest N lines and shows the window just above (a straddling multi-line item is sliced from the top). `itemLines` = `split("\n").length` for **every** kind — reasoning/system/user render raw newlines as real rows too, and under-counting them overflowed the window and scrolled history off the screen. Oversized non-assistant items are tailed (last lines kept) like assistant ones.
- `App` holds `scroll`/`scrollRef` (ref mirrors state — ink batching hazard). PageUp adds the page budget, PageDown subtracts (clamped at 0 = follow tail). Submit resets to 0.
- **View pin while scrolled up**: streaming callbacks go through `grow()`, which counts tail-item line deltas (`seen`) and bumps `scroll` by the same delta — new content grows below without jumping the screen. `seen` always tracks (not only when scrolled) so a mid-stream PageUp doesn't miscount.
- **Parse cost**: `parseMarkdown` is an LRU (300 entries) keyed by text — streaming re-parses of the growing prefix collapse to Map lookups; `Markdown` is `memo`ized so stable items don't re-render. `clampItems` line counting avoids `parseMarkdown` entirely (plain `split`).

---

Index: [`docs/architecture.md`](../architecture.md)
