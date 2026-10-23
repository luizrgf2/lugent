# Future Features (Out of Scope for v1)

Features deliberately excluded from v1. Each entry states what it is, why it was
deferred, and the trigger that justifies adding it.

## v1 baseline (for reference)

- TS + Bun, REPL CLI on top of a pure core lib (in-process, no HTTP).
- SQLite (`bun:sqlite`) session persistence: messages, tool results, abort marks.
- Agent loop with stable-prefix prompt builder (cache-friendly).
- Six tools: `read`, `glob`, `grep`, `edit`, `write`, `shell`.
- Skills: advertise `{id, name, description}`, load body via `skill` tool.
- Permissions: simple `allow` / `ask` per tool.
- Providers: any OpenAI-compatible `/v1` base URL, model list via `/models`,
  offline detection when unreachable.
- Streaming output + Ctrl+C abort.

## Deferred

### Architecture

| Feature | Why deferred | Add when |
| --- | --- | --- |
| HTTP server (client-server split, OpenCode-style) | Doubles surface area (routes, local auth, SSE events) before any feature needs it | A second client exists (web UI, SDK consumer) |
| Per-item transcript virtualization (stable ids, measured heights, arbitrary anchor) | Line-based tail-clamped window already renders O(viewport); virtualization adds bookkeeping without a felt win | Users report jank on huge single messages or want pixel-scroll/mouse-wheel anchors |
| Plugin / hook system | No extension consumers yet | External contributors or per-project behavior injection needed |
| Config layering (global + project merge, nested `AGENTS.md` discovery on exploration) | Single config + root `AGENTS.md` covers v1 | Monorepo / multi-package use appears |

### Context management

| Feature | Why deferred | Add when |
| --- | --- | --- |
| Compaction (summarize old conversation near context limit) | Lossy, complex; v1 fails loudly instead | Sessions regularly hit context limit |
| Provider-native compaction (encrypted checkpoints) | Tied to specific provider APIs | OpenAI Responses-style models become primary |
| Tool output pagination to managed files (OpenCode's 2k lines / 50 KiB pages) | Simple truncation suffices at v1 scale | Tool outputs regularly blow past truncation limit |

### Skills

Existing baseline: user (`~/.agents/skills/`) + project (`.agents/skills/`) scopes, same id → project wins; frontmatter `description` advertised in the system prompt (body on demand via the `skill` tool); TUI `/skills` is a read-only browser.

| Feature | What it would be | Why deferred | Add when |
| --- | --- | --- | --- |
| Skill selector (enable/disable per session or per project) | Toggle skills on/off from `/skills` (space to toggle, state shown inline); disabled skills drop out of the system prompt advertisement. Per-project persistent selection (e.g. `.agents/skills.json`) + per-session ephemeral override. | Every installed skill is currently wanted in every session; a toggle is UI + prompt-rebuild surface with no user yet | Installed skill count makes the advertisement block visibly bloat the prompt, or conflicting skills (two coding-style guides) need scoping |
| Skill packs / grouping (select a named set, e.g. `frontend`) | Group skills by frontmatter `tags` or dir, toggle the group as one | Speculative taxonomy — no multi-domain skill collections installed | Heterogeneous skill libraries (10+ across domains) appear |
| Skill priority / ordering beyond project-wins | Explicit `priority` frontmatter overriding the same-id shadowing rule | One resolution rule (project wins) covers all known cases | Two non-shadowing skills must apply in a defined order |

### Agents

Existing baseline: primary agents shipped — markdown profile at `.agents/agents/**/*.md`
(body = system prompt; frontmatter `description`, `model`, `tools`, `permissions`),
selected with `/agent`, default from `defaultAgent`. Loader: `src/core/agents.ts`;
usage and fields: `README.md` § "Agents".

| Feature | Why deferred | Add when |
| --- | --- | --- |
| Subagents (child sessions, fresh context, parallel work) | Significant session-model complexity | Long tasks need context isolation or parallelism |
| Hidden maintenance agents (title, summary generation) | Cosmetic | Session lists get unwieldy |
| Steps limit (remove tools on final step, force text answer) | Loop discipline not yet a problem | Agents loop excessively on hard tasks |

### Tools

| Feature | Why deferred | Add when |
| --- | --- | --- |
| `webfetch` / `websearch` | Core coding loop does not need web | Docs lookup tasks become common |
| `patch` (multi-file add/update/delete in one call) | `edit` + `write` cover v1; `patch` maps to GPT-style tool APIs | Multi-file refactor churn hurts |
| `question` tool (structured choices for the user) | Permission `ask` prompts cover basic interaction | Agents need mid-task branching decisions |
| `execute` (JS sandbox for parallel tool calls + result processing) | Nice-to-have; loop can issue parallel calls natively | Context pollution from intermediate results hurts |
| `subagent` tool | See Subagents above | Same trigger |
| Formatter integration after `edit` / `write` | Projects vary; no default | Config exposes `formatter` |
| Browser namespace (tabs, snapshots, screenshots, network inspection) | Large surface, desktop-app territory | Frontend iteration workflow needed |
| Worktree / session management utilities | REPL covers basic flow | Parallel experiment workflow needed |
| Attachments (images, PDFs into prompt) | Text-first v1 | Multimodal models become primary |
| References (named external directories) | Security-sensitive | Needed for monorepo-external context |

### Ecosystem

| Feature | Why deferred | Add when |
| --- | --- | --- |
| MCP client (external tool servers) | Protocol implementation is its own project | Third-party tools (browser, DB, APIs) wanted |
| Skills HTTP catalogs (remote `index.json` sources) | Local skills suffice | Team-shared skill distribution needed |
| Snapshots / checkpoints (revert session state) | Requires storage + UI design | Destructive mistakes become common |

### Permissions & safety

| Feature | Why deferred | Add when |
| --- | --- | --- |
| Full rule engine (wildcards, per-resource rules, last-match-wins ordering, saved approvals) | v1 uses one allow/ask flag per tool | Fine-grained policies needed (e.g. deny `git push`, allow `git status`) |
| Shell command scanning / inference of affected directories | Heuristic-heavy | Shell becomes default-allow |

### Provider layer

| Feature | Why deferred | Add when |
| --- | --- | --- |
| Non-OpenAI-compatible providers (Anthropic native, etc.) | OpenAI-compat covers most gateways and local servers | A required model lacks an OpenAI-compatible endpoint |
| Advanced rate-limit handling (queues, per-provider budgets) | Simple backoff suffices | Shared/team usage appears |
| Usage dashboards / cost reporting UI | v1 only accumulates `usage` totals per session | Cost visibility becomes a pain point |
