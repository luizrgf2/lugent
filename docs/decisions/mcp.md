# Decisions — MCP

## 2026-10-24 — `mcp` merges both config files; a disabled entry stays listed
Decision: the `mcp` map merges global then project (project wins per server, replacing the whole entry), matching agents/skills; `enabled: false` keeps the entry and is reported as `disabled` instead of being dropped. `providers`' first-file-wins is untouched.
Why: a project often needs to *disable* one global server, which is only expressible if the entry survives the merge; dropping disabled entries would also make `/mcp` unable to re-enable them. Keeping `providers` as-is avoids an unrelated behavior change.
Cost if wrong: a project cannot delete a global server, only disable it (an unused entry lingers in `/mcp`); if a merge-vs-override semantics change is ever wanted for `providers`, the two paths diverge and both need revisiting.

## 2026-10-24 — MCP v1 targets the legacy `initialize` + `Mcp-Session-Id` revision
Decision: the client sends `2025-06-18`, accepts `2025-03-26`/`2024-11-05`, performs the `initialize` handshake and echoes `Mcp-Session-Id`; the later stateless revision is not implemented.
Why: every real server we target (chrome-devtools, browsermcp, takeflow) predates the stateless revision and still requires the handshake; implementing only the newest revision would fail against all of them.
Cost if wrong: a server that requires the stateless revision would need a second code path (`protocol.ts` centralizes the version constants, so the addition is localized).

## 2026-10-24 — MCP tools default to `ask`
Decision: every tool bridged from an MCP server gets the `ask` permission; an agent's `tools`/`permissions` can allow, ask or deny it by name.
Why: MCP servers are untrusted third parties whose tools often shell out, browse, or write; defaulting them to `allow` would let any server in `lugent.json` act without a prompt.
Cost if wrong: a server used every turn prompts repeatedly unless the user grants `a` (session-scoped) or allows it in an agent — acceptable friction versus silent third-party execution.

## 2026-10-24 — `ToolDef.schema` is a passthrough JSON Schema; `validateArgs` checks top-level primitives only
Decision: `ToolDef.schema` widened from the built-in tool shape to `JsonSchema`; `validateArgs` enforces only `required` presence and top-level `string`/`number`/`boolean` types, leaving nested/object properties unchecked.
Why: MCP servers supply arbitrary schemas; a strict validator would have to reimplement JSON Schema (a dependency, against the zero-dep core) and any divergence would *reject a valid call* — worse than passing it through for the server to validate, which is the server's own contract anyway.
Cost if wrong: a malformed nested argument reaches the server and comes back as its own error (a tool result the model can retry on), instead of being caught locally; built-in tools keep their exact schemas, so nothing there loosens.

## 2026-10-24 — `/mcp` enable/disable is session-scoped, never rewrites `lugent.json`
Decision: `/mcp` reconnects/disables/enables servers in the running `McpManager` only; the choice is not persisted, and lugent never writes `lugent.json`.
Why: a config file can hold secrets (tokens in `headers`), so having a turn silently rewrite it is a hazard the user did not ask for; toggling is a runtime convenience, and restart is a clear, predictable way back to the configured state. Persisting a global server from inside a project was also ambiguous about *which* file to edit.
Cost if wrong: a user who wants a server off permanently must edit the file by hand; a `--persist` flag or an explicit `/mcp save` is the upgrade path, deliberately deferred.

## 2026-10-24 — a project `lugent.json` may declare MCP servers that execute at startup
Decision: project scope is trusted for `mcp`: a `local` server's `command` is spawned at startup (via `loadMcpConfig` reading the project file) with no trust prompt, exactly like a project `AGENTS.md`, skill or agent is trusted. `enabled: false` is the opt-out.
Why: consistency — this repo already decided project `AGENTS.md`/skills are trusted-repo channels and that a project agent may grant `allow`, so gating only MCP would be inconsistent; and a per-repo trust store is a new subsystem nobody asked for. Local MCP servers are *inherently* commands, so the capability cannot be removed without removing the transport.
Cost if wrong: cloning a hostile repo and running lugent executes its `lugent.json` commands before any prompt or permission dialog — the `ask` default covers tool *calls*, not the transport. Mitigation today is visibility: `/mcp` lists every server and its failure, and this note is in the README. Upgrade path if it bites: require `enabled: true` for project-declared servers, or a first-run trust prompt per repo.

## 2026-10-24 — MCP knowledge lives in an always-loaded prompt section, not a skill

Decision: a short `# MCP` section is the **first** part of the system prefix (`prompt.ts`), unconditional and independent of the agent; it is not a built-in skill.

Why: an agent prompt *replaces* `SYSTEM_PROMPT`, so MCP knowledge placed there would vanish under `plan` or any user-defined agent — the section has to be its own prefix part, like `# Tools`. The primary use case is answering a factual question ("where does the MCP config live?") and installing on request; the lazy route (a skill) depends on the model *deciding* to load the body, which is exactly the decision that fails on a factual question — it would answer from the one-line description. It is unconditional so a user with no server configured — precisely the user who asks how to add one — still gets the answer, and short (~12 lines) so the cost is small and prefix-cacheable. Built-in skills do not exist today (skills load from the filesystem only), so the lazy route would also mean `BUILTIN_SKILLS` plus a `SkillMeta.body` seam.

Cost if wrong: every request pays ~12 lines of context, including for users who never touch MCP; the section is part of the frozen prefix, so growing it invalidates the provider cache once per change. Promotion trigger: if this becomes a *procedure* (validate the server, choose npx/uvx, confirm it actually started) or passes ~15 lines, move the body to a built-in skill and leave only a one-line pointer in the prefix.

## 2026-10-24 — OAuth callback uses the fixed port 48762, and a busy port fails loudly

Decision: the loopback listener binds `127.0.0.1:48762` (`OAUTH_CALLBACK_PORT`), path `/oauth/callback`; tests may pass `port: 0`, and the redirect URI always reports the *bound* port. If 48762 is taken, `authenticate` fails immediately with "port 48762 is already in use — close whatever holds it (another lugent?) and try again".

Why: the port must match the redirect URI registered with the authorization server, so it cannot be ephemeral in production; a fixed value is what makes the redirect URI stable across sign-ins. The reference implementation binds, and on `EADDRINUSE` returns silently — the user then waits forever in the browser with no feedback anywhere. Failing loudly in the terminal, where the person who started the flow is looking, turns a hang into an actionable message.

Cost if wrong: two lugent processes cannot authorize at the same time, and a port squatter blocks sign-in until it is released (the message names the port, so the fix is one `ss`/`lsof` away). Test-only `port: 0` keeps the suite from colliding with the real constant.

## 2026-10-24 — the `scope` parameter is sent only when `scopes` is configured

Decision: lugent does not negotiate or default scopes. `mcp.<name>.scopes` (a string array) is optional on a `remote` server; with it the consent URL and the RFC 7591 registration both carry `scope` joined by spaces, without it **no `scope` parameter is sent at all** — not an empty one.

Why: the authorization server knows which scopes it can grant and shows the user a consent screen; guessing a scope set from lugent would either over-ask (a scary prompt) or under-ask (a broken tool). Sending an empty `scope` is a different request from omitting it in several implementations (some reject it, some deny everything), so "absent" stays absent. Bad values (a string instead of an array, an empty array, non-strings) warn at config load and are dropped rather than half-applied.

Cost if wrong: a server that requires an explicit scope fails with its own error at the consent screen; the fix is one config line, and the README says so. A server that wants a *subset* of what the consent screen offers gets the full grant — the user's click is the control.

## 2026-10-24 — `tokenEndpoint` and `revocationEndpoint` are stored in the token entry

Decision: `McpOAuthEntry` persists the discovered `tokenEndpoint` (and `revocationEndpoint` when advertised) next to the issuer, client id and tokens, not just the issuer.

Why: without it every proactive refresh (60 s skew, so routinely every hour) would re-run PRM + RFC 8414 discovery first — two extra round-trips on the hot path of an ordinary tool call, and a second failure mode (network hiccup on the metadata URL) between the user and their tools. It also makes `logout` self-contained: revoking needs the endpoint and the client id, and the store already has both, so signing out never depends on the network to *find* where to revoke.

Cost if wrong: a server that rotates its endpoints (or moves hosts) keeps using the stale URL until the next interactive `authenticate`, which re-discovers and overwrites the entry — a documented recovery path, not a dead end.

## 2026-10-24 — the authorization server is injected as `FetchImpl`, not faked with a TLS loopback server

Decision: `src/core/mcp/oauth/request.ts` defines `type FetchImpl = (url, init?) => Promise<Response>` and every networked module in the subsystem takes one; tests pass a plain function that answers the PRM, metadata, registration and token URLs.

Why: the subsystem's security rule is "https only, checked before fetching". A fake AS over `http://127.0.0.1` would force either relaxing that check in tests or standing up a TLS server with a self-signed cert — the first makes the tests not test the rule, the second adds certificate plumbing unrelated to the feature. A function seam keeps real `https://` URLs in the test data, keeps the https check live in every test, and makes the AS behaviour readable as a switch statement. The one real socket in the suite is the loopback callback listener, which the fake `openBrowser` hits exactly as a browser would — so the part that genuinely needs a socket still gets one.

Cost if wrong: the tests do not exercise real TLS, redirects, or HTTP/2 against the authorization server — covered instead by the live acceptance run against a real server (takeflow), which is the human gate. A module that forgets to thread `fetchImpl` through would silently hit the network in tests; the review pass checks that every call site takes it.

## 2026-10-24 — `auth_required` is a status of its own, not a `failed` server

Decision: `McpServerStatus` gains `auth_required`. A `401` from a remote server lands there instead of `failed`, with no error string (`formatMcpState` renders "needs authentication"), and `/mcp` offers `authenticate` + `disable`.

Why: `failed` means "this server is broken, reconnect may help" — the available actions are right for a crash and useless for a missing credential, and the startup line (`mcp: <name>: <reason>`) reads as a defect report for what is really a first-run step. Separating the status lets startup say `needs authentication — run /mcp and choose authenticate`, gives the picker the correct action set, and keeps `failed` meaningful. `McpAuthRequiredError` is the single error that means "interactive sign-in required", so manager, transport and prompt all key off one thing.

Cost if wrong: `/mcp` has one more status to explain, and `mcpActions(status, type)` needs the status table to stay in sync (it is one function in `src/cli/commands.ts`, covered by a test, shared by REPL and TUI).

## 2026-10-24 — `logout` is offered only for `remote` servers

Decision: `mcpActions("connected", "remote")` returns logout + disable; `("connected", "local")` returns disable only.

Why: logging out means revoking a stored OAuth grant and deleting the token — a local server has neither. It is a spawned child with no credential to forget, so offering the action would be a button that removes nothing and, worse, implies a security control that does not exist.

Cost if wrong: a user with a `local` server sees one fewer action on a connected row; if local credential support ever lands (an env token?), the row gains the action and the type check in `mcpActions` is the one place to change.

## 2026-10-24 — `iss` is validated when present, required only when the AS advertises RFC 9207 support

Decision: on the authorization response, an `iss` that does not match the discovered issuer discards the flow (the code is never exchanged and nothing is stored); a *missing* `iss` fails only when the metadata set `authorization_response_iss_parameter_supported: true`. Independently, RFC 8414 §3.3 is enforced at discovery: the metadata document's `issuer` must equal the URL it was fetched from.

Why: `iss` exists to stop a mix-up attack where a malicious authorization server redirects to a legitimate client with its own code; comparing it when present costs nothing and closes the window for servers that send it. Requiring it unconditionally would break every server that predates RFC 9207 (takeflow among them) for no security gain — a server that sends no `iss` is not *claiming* to be someone else, and the metadata check plus the https-only rule already pin which AS we talked to. The RFC 8414 check is separate and cheap: it catches an AS whose metadata is served from a URL it does not own.

Cost if wrong: a malicious AS that omits `iss` and serves self-consistent metadata is theoretically indistinguishable at this layer — mitigated by the flow being user-initiated (the browser shows the consent host) and the token being bound to the `resource` parameter. If it bites, the upgrade is a strict allowlist (`iss` required) as a config flag.

## 2026-10-24 — The OAuth callback pages are self-contained and follow the system colour scheme

Decision: `successPage`/`errorPage` in `src/core/mcp/oauth/callback.ts` carry their CSS inline, are dark by default with a `prefers-color-scheme: light` block, and reference no external resource — no CDN, no web font, no image. The status glyphs are inline SVG with the `xmlns` attribute omitted (HTML5 puts an inline `<svg>` in the SVG namespace anyway, and the attribute would be a `http://` string the self-contained test forbids).

Why: `src/core/` is dependency-free and this page is served by a loopback listener on a machine that may be offline or firewalled — a remote stylesheet or font would render an unstyled or broken page at the exact moment the user is waiting for confirmation. Inline CSS keeps the whole flow in one file with one test seam. Dark by default matches the terminal the user just left; the light block covers a light desktop.

Cost if wrong: the CSS lives in a template string (no editor or typechecking for it) and `callback.ts` grows; a regression test asserts neither page contains `https?://`, `src=` or `@import`, so a later "just add a font" change fails loudly instead of silently depending on the network.

---

Index: [`docs/decisions.md`](../decisions.md) — one file per area, chronological within each.
