# Permissions

**Permissions.** Layers, first match wins: yolo flag (`runTurn(yolo)` — TUI's `/permissions` toggle, auto-approves everything including outside-project; the pick persists to the global config as `permissionMode`, a project `permissionMode` overrides it at load — same first-file-wins as `providers`), session-scoped `always` grants in SQLite, the outside-project guard (absolute/`..`/`~` resources force ask even for allow tools), the selected agent's per-tool override (`permissions: {tool: allow|ask}`, replacing the registry default), and finally the tool default (`allow`/`ask`). `deny` never reaches a decision — `toolsForAgent` drops the tool from the request, so the model does not see it. The outside check is pattern-level — symlink escapes are a known ceiling, not yet audited. `resourceFor` reads `path`, then `command`, then `agent`, then `id`, so a `subagent` grant/ask is keyed by the agent id — "always allow `subagent` on `reviewer`" grants exactly that launch target, not every subagent.

---

Index: [`docs/architecture.md`](../architecture.md)
