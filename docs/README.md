# Docs

Flat map of this repository's documentation. One small file per topic — never one big
file, because the big file is what rots.

For contributors the real entry point is the trigger table in `AGENTS.md` ("if you touch
X, read Y"); this file is the whole tree at a glance.

## Architecture

| Topic | File |
| --- | --- |
| Overview + source map | [`architecture.md`](architecture.md) |
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

## Decisions

| Area | File |
| --- | --- |
| Index | [`decisions.md`](decisions.md) |
| Core — store, prompt, permissions, provider | [`decisions/core.md`](decisions/core.md) |
| CLI & TUI | [`decisions/cli-tui.md`](decisions/cli-tui.md) |
| Agents | [`decisions/agents.md`](decisions/agents.md) |
| MCP | [`decisions/mcp.md`](decisions/mcp.md) |
| Process & docs | [`decisions/process.md`](decisions/process.md) |

## Elsewhere

| Topic | Where |
| --- | --- |
| User-facing docs — install, configuration, usage, tools, MCP, skills, agents | [`../README.md`](../README.md) |
| Deferred work and triggers | [`future-features.md`](future-features.md) |
| Commit and branch conventions, decision-log format | [`../.agents/skills/git-conventions/SKILL.md`](../.agents/skills/git-conventions/SKILL.md) |

## Adding a doc

One topic, short. Under ~150 lines — past that, split it and leave the canonical path as
an index. Link the new file from this page and from its area index, and add a trigger row
in `AGENTS.md`. Doc updates ship in the same commit as the code they describe.

`docs/specs/` and `docs/plans/` are internal design records, gitignored, never pushed.
