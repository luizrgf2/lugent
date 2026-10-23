<p align="center"><img src="docs/lugent.svg" alt="lugent — CLI agent" width="480"></p>

# lugent

A minimal OpenCode-style coding agent. REPL CLI over a pure core library — TypeScript + Bun, zero runtime dependencies.

**[lugent(1) — landing page](https://luizrgf2.github.io/lugent/)**

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
| `defaultAgent` | Optional agent id selected at startup. Defaults to `build`; unknown id → warning, then `build` |

At startup each provider gets a health check (`GET /models`, 8s timeout) — unreachable ones are reported as `OFF` but lugent still starts.

## Usage

In a terminal, `lugent` starts a **full-screen TUI** (React + Ink): scrollable transcript (items separated by blank lines, answers indented) with live model reasoning (labeled `… pensando` block, indented), markdown-rendered answers (headings, tables, lists), tool lines, inline y/n/a permission dialogs, and a braille spinner below the input while the agent loop runs.

```
╭─ lugent ───────────────────────────╮
│ lugent 9router · glm/glm-5.2   ▟▙ LUGENT   ses_1234 │   status: info left, centered L-mark, session right
╰────────────────────────────────────╯
> go                                ▏   composer: Enter submits, ↑/↓ history
  pondering which tool to use…         reasoning (dim, live)
▸ read src/main.ts                     tool calls
  all **done**                         answer (markdown-lite)
```

- **Ctrl+C once** aborts the running turn (and denies a pending permission); **twice** exits.
- **PageUp/PageDown** scroll the transcript (window = one page). Scrolling up during streaming pins the view — new content grows below without jumping the screen; submitting a new message snaps back to the tail.
- Slash commands: `/exit` quits; `/model` opens a two-level picker (provider → live model list via `listModels()`, `↑/↓`+Enter, Esc cancels, Ctrl+C closes); `/skills` browses loaded skills; `/resume` picks a past session of this directory (replays its transcript, next turn continues it — not a fork); `/permissions` toggles normal/yolo (yolo auto-approves every tool call, shown in the status bar); `/agent` opens the agent picker — the chosen profile's prompt, model and toolset apply from the next turn, and the status bar shows the active agent (`build` by default). Typing `/` in the composer shows an autocomplete box — it filters as you type, `↑/↓` move, Enter or Tab completes. Others work in `--plain` mode.
- `--plain` forces the inline REPL below; piped stdin (non-TTY) falls back to it automatically.
- **Image attachments**: mention a file with `@path/to.png` in your message (`.png` `.jpg` `.jpeg` `.gif` `.webp`, ≤20 MB, relative to the project root). It is sent to the model as an OpenAI vision `image_url` part — works with any multimodal model behind an OpenAI-compatible endpoint. Unresolvable markers stay literal text.

Plain REPL:

```
  ▟▙                              ANSI L-mark logo (terminal colors,
 ▟▛ ▚▖                             gradient from docs/lugent.svg)
▟▛   ▚▖
▀▀▀▀▙
LUGENT
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
> /resume                     # list this directory's sessions, pick one to continue
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

Using skills in a session:

- **Let the model pick them.** Advertised skills appear in the system prompt; when your request matches a description ("prepare a release"), the model calls `skill git-release` itself — you see the `▸ skill` line in the transcript.
- **Force one:** mention the id in your message ("use skill git-release to …").
- **Browse:** TUI `/skills` lists what is loaded (read-only, ↑/↓+Esc); plain REPL `/skills` lists ids. Toggling skills on/off is not implemented — every loaded skill is active in every session (selector design deferred, see `docs/future-features.md`).

## Agents

An agent is a named profile — system prompt, model, tool allowlist, permission overrides — defined in markdown, same shape as skills:

```
.agents/agents/reviewer.md         → id "reviewer"
.agents/agents/team/audit.md       → id "team/audit" (nested path is the id)
~/.agents/agents/reviewer.md       → user scope; project wins on the same id
```

### Built-in agents

Two agents are always present, in every install (inspired by OpenCode's pair, adapted: no rule engine, no plan files):

| Id | Prompt | Tools | Permissions |
| --- | --- | --- | --- |
| `build` | the base system prompt | all | tool defaults |
| `plan` | "plan mode": explore and design, no file changes | all but `edit`/`write` | `{edit: deny, write: deny}` |

Built-ins carry display colors (`build` magenta, `plan` yellow); the TUI context line — fixed above the input — shows a yellow `§ AGENTS.md loaded` when a project `AGENTS.md` was loaded, plus `· agent <id>` in the agent's color.

`build` is the startup default, so there is always a way back to a normal session (`/agent build`). `plan` can read, search and run shell commands — shell stays permission-controlled, as in OpenCode — it just cannot modify files. Both load **first**, so a file with the same id (user or project) overrides the built-in without removing it: drop `.agents/agents/plan.md` to give your own plan agent.

```markdown
---
description: Reviews changes read-only
color: cyan
model: 9router/glm-5.2
tools: [read, glob, grep]
permissions: {shell: ask}
---
You are a code reviewer. Report findings with file and line references.
```

| Field | Meaning | Default when absent |
| --- | --- | --- |
| `description` | shown by `/agent` | none |
| `color` | TUI display color for the agent: an ink color name (`red`, `cyan`…) or `#rrggbb`; display-only, invalid warns and uses the default | `magenta` (build's) |
| `model` | `provider/model`, both required — provider must exist in the config | inherit the session's |
| `tools` | tool ids sent to the model; anything else is invisible to it — a `tools` key that parses to nothing (typo, block-style YAML) fails closed to **no** tools, with a warning | all tools |
| `permissions` | per-tool `allow` / `ask` / `deny`; `deny` also removes the tool | tool default |

The body is the agent's system prompt: it **replaces** the base prompt, and AGENTS.md plus the skills advertisement are still added on top. A permission override replaces the tool's default — a session `always` grant still wins over it, and the outside-project guard still forces an ask.

Usage: `/agent` lists loaded agents (`build` and `plan` plus your file agents), `/agent reviewer` switches. Switching works mid-session — history is kept and the next turn runs with the new prompt, model and toolset; the switch line confirms provider/model/toolset, and the `# Tools` section of the prompt is filtered to match. An agent's `model` applies at startup (`defaultAgent`) and on `/resume`, not only when switched to. `/resume` restores the agent together with provider and model; `defaultAgent` picks the startup agent and defaults to `build` — an unknown id warns and falls back to `build`. Because `build` reuses the base prompt, the default system prefix stays byte-identical to a session with no agent (and sessions created before agents existed keep the base prompt). Bad frontmatter never breaks startup: an empty body drops that agent, and an unknown tool id or a `model` without `provider/` warns and falls back.

## Permissions & yolo

Every tool has a default (`allow` / `ask`, table above). During a turn the model may trigger an inline dialog:

- Answer `y` (once), `n` (deny — the model sees the refusal), or `a` (always this session, for that tool+resource). Anything else — including Enter — denies.
- Any resource outside the project root (absolute path, `..`, `~`) forces `ask` even for `allow` tools.

**Yolo mode** (TUI only — `--plain` REPL has no equivalent): `/permissions` → pick `yolo` and every tool call is auto-approved — no dialogs, **including outside-project paths**. The status bar shows a red `YOLO` while active. It is runtime state: not persisted, reset on restart, and it does not modify the per-session `a` grants. `/permissions` → `normal` (or restart) turns it off.

## Data

Sessions, messages and permission grants live in one SQLite file:

- Linux: `$XDG_DATA_HOME/lugent/db.sqlite` or `~/.local/share/lugent/db.sqlite`
- Windows: `%APPDATA%\lugent\db.sqlite`

## Development

```
bun test
```

The suite includes a golden snapshot pinning the system prompt byte-for-byte (provider prefix-cache stability) and an end-to-end turn with tool calls.

Out-of-scope features and their triggers: [docs/future-features.md](docs/future-features.md) · Architecture: [docs/architecture.md](docs/architecture.md)
