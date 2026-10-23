# Architecture

lugent is a thin REPL over a pure core library. Everything in `src/core/` is UI-free and testable; `src/cli/` owns the terminal.

```
src/main.ts                entry: config, store, health checks, starts REPL
src/cli/
  repl.ts                  readline loop, slash commands, SIGINT, prompts
  commands.ts              parseSlash, parseAnswer
src/core/
  config.ts                lugent.json / global config, {env:VAR}
  platform.ts              per-OS db path, shell command
  types.ts                 Message, ToolCall, ChatMsg, SkillMeta, ...
  store.ts                 SQLite (bun:sqlite): sessions, messages, permissions
  skills.ts                .agents/skills loader (user ~/.agents + project) + frontmatter parser
  agents.ts                .agents/agents loader (markdown profile: prompt, model, tools, permissions) + built-ins (build, plan)
  prompt.ts                system prefix builder + history→wire mapping
  provider.ts              OpenAI-compatible SSE client
  permissions.ts           allow/ask decision, resource extraction
  loop.ts                  agent turn loop
  tools/                   registry + read glob grep edit write shell skill
```

## Turn flow

```
user input
  → append user message (store)
  → loop:
      prefix   = buildPrefix(promptInput)          # byte-stable per agent
      history  = cleanHistory(store.getMessages)   # orphan repair
      messages = buildMessages(prefix, history)    # system + wire format
      tools    = toolsForAgent(allTools, agent)    # agent allowlist minus denied
      res      = provider.chat(messages, tools)    # SSE stream
      if no toolCalls → append assistant text, done
      append assistant message (toolCalls)
      if aborted → flag session, stop (no tool runs)
      run all toolCalls in parallel:
        resolve tool → permission check → validateArgs → execute
        append tool result (truncated at 10k chars)
```

## Design decisions

**Built-in agents.** `BUILTIN_AGENTS` (`build`, `plan`) is hardcoded in `agents.ts` and merged *before* the file scopes, so every install has both and a file with the same id overrides one instead of removing it. `build.prompt` is `SYSTEM_PROMPT` itself — one source of truth, and the default prefix stays byte-identical (the golden snapshot keeps guarding it). `resolveAgent(agents, id)` is the single resolution point: requested id if it exists, else `build` (what `defaultAgent` unset and an unknown id both land on); sessions store the resolved id, and a `null` agent (a session created before agents shipped) keeps the base prompt. New sessions therefore start on `build`, which is also the way back from `plan`.

**Byte-stable prefix.** The system prompt is rebuilt from immutable inputs every iteration and pinned by a golden snapshot test. Identical bytes across requests let providers reuse their prompt cache — one changing line silently kills caching. A selected agent's prompt *replaces* the base prompt and gets its own pinned snapshot, so the prefix is byte-stable per agent; switching agent invalidates the cache once.

**Append-only store, repaired on read.** Messages are never edited after insert. `cleanHistory` normalizes at request time: unanswered `tool_calls` are stripped from assistant messages, results whose call vanished are dropped. This is what survives aborts and crashes — a stored assistant call without its result row would produce an orphan `tool_calls`/`tool` pair in the wire format and 400 the provider.

**SSE fragment accumulation.** Streaming `delta.tool_calls` arrive name-first then arguments in arbitrary chunk splits. Provider accumulates by `index` and concatenates `arguments` before parsing. Malformed JSON arguments stay a raw string — the loop's `validateArgs` turns them into a schema-error tool result so the model can retry, instead of crashing the turn. Events are yielded as they arrive (`parseSSE` is an async generator), so `onToken`/`onReasoning` fire during the stream — never buffered until the end.

**Permissions.** Layers, first match wins: yolo flag (`runTurn(yolo)` — TUI-only `/permissions` toggle, auto-approves everything including outside-project, runtime state not persisted), session-scoped `always` grants in SQLite, the outside-project guard (absolute/`..`/`~` resources force ask even for allow tools), the selected agent's per-tool override (`permissions: {tool: allow|ask}`, replacing the registry default), and finally the tool default (`allow`/`ask`). `deny` never reaches a decision — `toolsForAgent` drops the tool from the request, so the model does not see it. The outside check is pattern-level — symlink escapes are a known ceiling, not yet audited.

**Provider.** `stream: true` always; retries up to 3 attempts with exponential backoff; streams are idle-guarded — no bytes for 120s (`idleTimeoutMs`) aborts the read with `stream stalled`, surfaced as a provider error instead of a forever-hung turn; `GET /models` doubles as health check. Works with any OpenAI-compatible `/v1` endpoint.

**Zero dependencies.** `bun:sqlite`, `Bun.spawn`, `Bun.Glob.scanSync` (the async `scan()` is an AsyncGenerator — `Array.from` silently yields `[]`), `fetch`. No SDK, no framework.

**Platform split.** `platform.ts` centralizes OS choices (db path via `APPDATA`/`XDG_DATA_HOME`, shell `cmd /c` vs `bash -c`) as pure functions — testable without a Windows box.

## Schema

```sql
session    (id, title, created_at, provider, model, agent, directory, aborted)   -- directory scopes /resume; legacy null rows are excluded; agent holds the resolved id (build for new sessions) and null only for rows created before agents shipped, where the base prompt applies; restored by /resume
message    (id, session_id, role, content, tool_calls, tool_call_id, meta, created_at)
permission (session_id, tool, resource)   -- "always" grants
```

## Testing

One test file per module plus `src/e2e.test.ts` (full turn: skill advertisement in prefix, tool call, prefix stability across iterations). Golden snapshot: `src/core/__snapshots__/`. The project was built test-first throughout.

## TUI layer

`src/cli/tui/` renders the full-screen interface (React + Ink v8); `src/cli/repl.ts` is the `--plain`/piped fallback. `src/main.ts` picks: TTY stdin+stdout → TUI, anything else → REPL. Shared prompt-building lives in `src/cli/context.ts` (`buildPromptInput`).

```
provider.chat (SSE)
  onReasoning(chunk) → TItem "reasoning" (dim italic; display-only, never stored)
  onToken(chunk)     → TItem "assistant" (markdown-lite: fences, `code`, **bold**, #h1-3)
  onToolStart        → TItem "tool" (glyph + name + resource)
  onAsk              → Permissions dialogs, queued in order (parallel asks would race); y/n/a; Ctrl+C denies + aborts
```

Files: `app.tsx` (state + turn flow + `runTui`), `status.tsx` (bar; shows provider/model/session/YOLO, plus the agent id — always set: `build` by default), `transcript.tsx` (`itemsFromHistory` maps stored messages back to TItems for `/resume` replay — reasoning is never persisted), `input.tsx` (refs mirror state — ink batches keys into one render, stale-closure hazard; optional `completions` prop renders a slash-command autocomplete box under the composer: prefix-filtered, `↑/↓` move, Tab completes), `permissions.tsx`, `model-picker.tsx` (`/model`: provider list → live `listModels()`, windowed 8 rows, pick updates provider+model state and appends a dim `system` line), `skill-list.tsx` (`/skills`: read-only windowed list of loaded skills), `agent-picker.tsx` (`/agent`: windowed agent list with descriptions; picking switches the profile and persists it via `store.setAgent`), `session-picker.tsx` (`/resume`: windowed session list scoped to the project directory; picking one switches session state, restores provider/model and replays `itemsFromHistory`), `permission-mode.tsx` (`/permissions`: normal/yolo toggle, yolo sets `runTurn(yolo)`), `markdown.ts` (pure parser), `harness.tsx` (test-only renderer).

Provider: `chat(args.onReasoning?)` forwards `delta.reasoning_content` chunks. Not accumulated into `content`, not persisted — replaying a session shows no reasoning (accepted).

Provider injection: `env.makeProvider?(cfg, model)` (tests); default `new Provider(cfg, model)`.

### Transcript windowing & scroll

Rendering stays O(viewport) regardless of history length — no item outside the window is ever rendered:

- `clampItems(items, maxLines, skipBottom)` walks items newest→oldest, line-budgeted. `skipBottom` scrolls up: it hides the newest N lines and shows the window just above (a straddling multi-line item is sliced from the top). `itemLines` = `split("\n").length` for assistant items, 1 otherwise.
- `App` holds `scroll`/`scrollRef` (ref mirrors state — ink batching hazard). PageUp adds the page budget, PageDown subtracts (clamped at 0 = follow tail). Submit resets to 0.
- **View pin while scrolled up**: streaming callbacks go through `grow()`, which counts tail-item line deltas (`seen`) and bumps `scroll` by the same delta — new content grows below without jumping the screen. `seen` always tracks (not only when scrolled) so a mid-stream PageUp doesn't miscount.
- **Parse cost**: `parseMarkdown` is an LRU (300 entries) keyed by text — streaming re-parses of the growing prefix collapse to Map lookups; `Markdown` is `memo`ized so stable items don't re-render. `clampItems` line counting avoids `parseMarkdown` entirely (plain `split`).

## Testing (TUI)

`harness.tsx` renders through ink's real `render()` with fake stdin/stdout: frames are captured, ANSI-stripped, asserted with `toContain`. Keys are typed one per write (`type("hi\r")`) mirroring raw-mode terminals. `ink-testing-library` declares `ink: ^5` and misbehaves on v8 (triplicated events, stale frames) — do not reintroduce it.
