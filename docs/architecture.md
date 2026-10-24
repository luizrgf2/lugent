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
  mcp/                     MCP: config parsing, transports (stdio/http), client, tool bridge, runtime manager
```

## Index

| Topic | File |
| --- | --- |
| Turn flow — store → loop → provider → tools | [`architecture/turn-flow.md`](architecture/turn-flow.md) |
| Prompt & agents — byte-stable prefix, built-ins | [`architecture/prompt-and-agents.md`](architecture/prompt-and-agents.md) |
| Persistence — append-only store, schema | [`architecture/persistence.md`](architecture/persistence.md) |
| Provider — SSE accumulation, retries | [`architecture/provider.md`](architecture/provider.md) |
| Permissions — layers, outside-project guard | [`architecture/permissions.md`](architecture/permissions.md) |
| Platform & dependencies — OS split, zero deps | [`architecture/platform.md`](architecture/platform.md) |
| MCP — transports, client, tool bridge | [`architecture/mcp.md`](architecture/mcp.md) |
| MCP OAuth — sign-in, token store, refresh | [`architecture/mcp-oauth.md`](architecture/mcp-oauth.md) |
| TUI layer — Ink app, transcript windowing | [`architecture/tui.md`](architecture/tui.md) |
| Testing — unit, e2e, golden snapshot | [`architecture/testing.md`](architecture/testing.md) |
