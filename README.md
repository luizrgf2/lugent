# lugent

A minimal OpenCode-style coding agent. REPL CLI over a pure core library — TypeScript + Bun, zero runtime dependencies.

```
bun src/main.ts
```

## Requirements

- [Bun](https://bun.sh) 1.3+
- Any OpenAI-compatible chat endpoint (`/v1`): Ollama, LM Studio, OpenRouter, local routers, etc.

## Configuration

lugent reads the **first file found** — no merging between the two:

1. `<project>/lugent.json` (wins)
2. `~/.config/lugent/config.json` (global fallback; works on Windows too)

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "{env:OLLAMA_API_KEY}"
    }
  },
  "defaultProvider": "ollama",
  "defaultModel": "qwen3.5:14b"
}
```

| Field | Description |
| --- | --- |
| `providers.<name>.baseUrl` | OpenAI-compatible base URL. Must include `/v1` |
| `providers.<name>.apiKey` | Optional. `{env:VAR}` is substituted at load; unknown vars become `""` |
| `defaultProvider` | Key into `providers` used at startup |
| `defaultModel` | Model id sent as `model` on every request |

At startup each provider gets a health check (`GET /models`, 8s timeout) — unreachable ones are reported as `OFF` but lugent still starts.

## Usage

In a terminal, `lugent` starts a **full-screen TUI** (React + Ink): scrollable transcript with live model reasoning (dim italic), markdown-rendered answers, tool lines, and inline y/n/a permission dialogs.

```
╭─ lugent ───────────────────────────╮
│ lugent 9router · glm/glm-5.2 · ses │   status: provider · model · session
╰────────────────────────────────────╯
> go                                ▏   composer: Enter submits, ↑/↓ history
  pondering which tool to use…         reasoning (dim, live)
▸ read src/main.ts                     tool calls
  all **done**                         answer (markdown-lite)
```

- **Ctrl+C once** aborts the running turn (and denies a pending permission); **twice** exits.
- Slash commands: `/exit` quits; `/model` opens a two-level picker (provider → live model list via `listModels()`, `↑/↓`+Enter, Esc cancels, Ctrl+C closes); `/skills` browses loaded skills. Others work in `--plain` mode.
- `--plain` forces the inline REPL below; piped stdin (non-TTY) falls back to it automatically.

Plain REPL:

```
┌─ lugent ──────────────┐
│ session ses_676f…     │      banner on startup
│ 9router · glm/glm-5.2 │
└───────────────────────┘
> read src/main.ts            # plain message: the model drives the tools
▸ read  src/main.ts           # tool lines use glyphs (▸ read, ✎ edit, $ shell…)
⠙ thinking…                   # spinner while the turn runs
> /model                      # list models of the current provider
> /model ollama qwen3.5:14b   # switch provider (+ optional model)
> /skills                     # list advertised skills
> /clear                      # start a fresh session
> /exit                       # quit
```

- UI is hand-rolled ANSI (`src/cli/ui.ts`) in plain mode; colors/spinner auto-disable when output is piped.
- Permission prompts answer `y` / `n` / `a` (always, session-scoped). Anything else — including Enter — denies.
- `--db <path>` overrides the database location.

## Tools

| Tool | Default | Does |
| --- | --- | --- |
| `read` | allow | File with numbered lines (offset/limit) or directory listing; rejects binary |
| `glob` | allow | Glob file search (`**/*.ts`), limit 100 |
| `grep` | allow | Content search, `path:line:preview`, regex or literal, skips binary |
| `edit` | ask | Unique-match string replace (`replaceAll` opt-in), returns diff |
| `write` | ask | Create/replace file, creates parent dirs |
| `shell` | ask | `bash -c` (`cmd /c` on Windows), timeout default 2min, `background: true` |
| `skill` | allow | Load a skill body by id |

**Extra guard:** any resource outside the project root (absolute path, `..`, `~`) forces an `ask` even for `allow` tools, unless already granted for the session.

## Skills

Drop markdown files in `.agents/skills/` — nested dir or flat. Both scopes load (user `~/.agents/skills/` + project `.agents/skills/`; on Windows the user scope is `%USERPROFILE%\.agents\skills` — same layout). Same id → project wins:

```
.agents/skills/git-release/SKILL.md   → id "git-release"
.agents/skills/review.md              → id "review"
```

```markdown
---
name: Git Release
description: Prepare and publish releases
---
Step 1: ...
```

Skills with a `description` in the frontmatter are advertised in the system prompt (id, name, description only). The model loads the full body on demand via the `skill` tool — skill content never bloats the prompt upfront.

## Data

Sessions, messages and permission grants live in one SQLite file:

- Linux: `$XDG_DATA_HOME/lugent/db.sqlite` or `~/.local/share/lugent/db.sqlite`
- Windows: `%APPDATA%\lugent\db.sqlite`

## Development

```
bun test
```

72 tests, including a golden snapshot pinning the system prompt byte-for-byte (provider prefix-cache stability) and an end-to-end turn with tool calls.

Out-of-scope features and their triggers: [docs/future-features.md](docs/future-features.md) · Architecture: [docs/architecture.md](docs/architecture.md)
