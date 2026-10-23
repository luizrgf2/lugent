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
  skills.ts                .agents/skills loader + frontmatter parser
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
      prefix   = buildPrefix(promptInput)          # byte-stable
      history  = cleanHistory(store.getMessages)   # orphan repair
      messages = buildMessages(prefix, history)    # system + wire format
      res      = provider.chat(messages, tools)    # SSE stream
      if no toolCalls → append assistant text, done
      append assistant message (toolCalls)
      if aborted → flag session, stop (no tool runs)
      run all toolCalls in parallel:
        resolve tool → permission check → validateArgs → execute
        append tool result (truncated at 10k chars)
```

## Design decisions

**Byte-stable prefix.** The system prompt is rebuilt from immutable inputs every iteration and pinned by a golden snapshot test. Identical bytes across requests let providers reuse their prompt cache — one changing line silently kills caching.

**Append-only store, repaired on read.** Messages are never edited after insert. `cleanHistory` normalizes at request time: unanswered `tool_calls` are stripped from assistant messages, results whose call vanished are dropped. This is what survives aborts and crashes — a stored assistant call without its result row would produce an orphan `tool_calls`/`tool` pair in the wire format and 400 the provider.

**SSE fragment accumulation.** Streaming `delta.tool_calls` arrive name-first then arguments in arbitrary chunk splits. Provider accumulates by `index` and concatenates `arguments` before parsing. Malformed JSON arguments stay a raw string — the loop's `validateArgs` turns them into a schema-error tool result so the model can retry, instead of crashing the turn. Events are yielded as they arrive (`parseSSE` is an async generator), so `onToken`/`onReasoning` fire during the stream — never buffered until the end.

**Permissions.** Three layers: tool default (`allow`/`ask`), session-scoped `always` grants in SQLite, and an outside-project guard (absolute/`..`/`~` resources force ask even for allow tools). The outside check is pattern-level — symlink escapes are a known ceiling, not yet audited.

**Provider.** `stream: true` always; retries up to 3 attempts with exponential backoff; `GET /models` doubles as health check. Works with any OpenAI-compatible `/v1` endpoint.

**Zero dependencies.** `bun:sqlite`, `Bun.spawn`, `Bun.Glob.scanSync` (the async `scan()` is an AsyncGenerator — `Array.from` silently yields `[]`), `fetch`. No SDK, no framework.

**Platform split.** `platform.ts` centralizes OS choices (db path via `APPDATA`/`XDG_DATA_HOME`, shell `cmd /c` vs `bash -c`) as pure functions — testable without a Windows box.

## Schema

```sql
session    (id, title, created_at, provider, model, aborted)
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

Files: `app.tsx` (state + turn flow + `runTui`), `status.tsx`, `transcript.tsx`, `input.tsx` (refs mirror state — ink batches keys into one render, stale-closure hazard), `permissions.tsx`, `model-picker.tsx` (`/model`: provider list → live `listModels()`, windowed 8 rows, pick updates provider+model state and appends a dim `system` line), `markdown.ts` (pure parser), `harness.tsx` (test-only renderer).

Provider: `chat(args.onReasoning?)` forwards `delta.reasoning_content` chunks. Not accumulated into `content`, not persisted — replaying a session shows no reasoning (accepted).

Provider injection: `env.makeProvider?(cfg, model)` (tests); default `new Provider(cfg, model)`.

## Testing (TUI)

`harness.tsx` renders through ink's real `render()` with fake stdin/stdout: frames are captured, ANSI-stripped, asserted with `toContain`. Keys are typed one per write (`type("hi\r")`) mirroring raw-mode terminals. `ink-testing-library` declares `ink: ^5` and misbehaves on v8 (triplicated events, stale frames) — do not reintroduce it.
