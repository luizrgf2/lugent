# MCP

MCP servers are configured in the `mcp` map (see README § Configuration) and owned at runtime by `McpManager` (`src/core/mcp/manager.ts`): it connects every enabled server in parallel at startup, isolates failures, and is what `/mcp` drives to reconnect/disable/enable without a restart. `src/main.ts` keeps the live tool array and swaps MCP tools in and out via `mcp.onChange`.

Cleanup is registered *before* connecting, and the manager tracks clients that are not yet attached to an entry: a server that spawns and then stalls its handshake is mid-connect, so `closeSync` must already be able to reach its child. `process.on("exit", () => mcp.closeSync())` covers the normal exit path, and SIGTERM/SIGHUP/SIGINT handlers cover the signals whose default action skips exit handlers — they are kept for the whole process lifetime, which is safe because a raw-mode TTY (readline and ink both set it) delivers `^C` as a keystroke, not a signal, so Ctrl+C still belongs to the REPL/TUI. A stdio child that dies on its own reports through `McpClient.onClosed`, which flips its entry to `failed` and re-emits the toolset, so `/mcp` offers `reconnect` instead of pretending it is still up. An HTTP server has no such signal: a dead remote endpoint is only noticed on its next failed call (accepted limitation — a persistent socket would be the fix).

```
McpManager ──connectServer──▶ Transport (stdio | http)
                                 ⇅ JSON-RPC 2.0
                            McpClient  (id counter, pending map, timeouts, handshake)
                                 ↓ tools/list
                            mcpToolDefs ──▶ ToolDef[]  (into the registry)
```

**Transport seam.** `Transport` (`transport.ts`) is three methods — `start(handlers)`, `send(msg)`, `close()` — plus `closeSync()` for the process-exit path (never awaits). `StdioTransport` spawns the child with `Bun.spawn`, frames stdout through `LineBuffer` (`framing.ts`, capped so an unterminated oversized payload surfaces an error instead of growing the heap) and drains stderr so a chatty server cannot block on a full pipe; `HttpTransport` posts one JSON-RPC message per request, keeps the `Mcp-Session-Id` it receives and echoes it, accepts `application/json` or `text/event-stream` (parsed reusing the provider's `parseSSE`), treats `202` as "notification accepted, no reply", and raises `McpAuthRequiredError` on `401`. When a token provider is supplied the transport asks it **per send**, so a refresh between two messages is picked up, and a `401` triggers exactly one forced refresh + retry before giving up. The client is transport-agnostic: it owns the id counter, the pending map, per-request timeouts (default 30s) and fail-fast once closed.

**Legacy revision.** v1 speaks the `initialize` handshake + `Mcp-Session-Id` revision (`2025-06-18`, with `2025-03-26`/`2024-11-05` accepted), not the later stateless one — every real server we target predates it. After `initialize` the client sends the `notifications/initialized` notification, then `tools/list` (following `nextCursor`) and `tools/call`.

**Tool bridging.** Each tool becomes a `ToolDef` named `<server>_<tool>` (sanitized to `[A-Za-z0-9_-]`, collapsed underscores, 64-char cap); a name collision drops the later tool, not the whole server. The MCP `inputSchema` passes through as a raw JSON Schema — `ToolDef.schema` was widened to `JsonSchema` and `validateArgs` only enforces `required` plus top-level `string`/`number`/`boolean`, because a nested MCP schema is the server's contract and a false rejection is worse than a passthrough. Every bridged tool defaults to the `ask` permission: MCP servers are untrusted third parties.

The config `mcp` map merges both config files (global first, project wins per server) rather than `providers`' first-file-wins — see `docs/decisions.md`.

The agent is told this surface by the always-present `# MCP` prompt section (`prompt.ts`), so it can answer questions about it and install a server on request: it edits the config with `write`/`edit` (both `ask`, so nothing is rewritten silently) and tells the user to restart. That is the deliberate split — `/mcp` toggles for the session without touching the file, the file tools persist but always with a permission prompt. The section shows the literal entry JSON rather than describing it in prose: a model given only prose invented `{"local": {...}}` instead of `{"type": "local", "command": [...]}` (observed in a live turn, pinned by a test).

---

Index: [`docs/architecture.md`](../architecture.md)
