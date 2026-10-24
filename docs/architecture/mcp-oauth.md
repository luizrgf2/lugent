# OAuth for remote servers

`remote` servers that refuse static headers get an interactive OAuth 2.1 sign-in, driven entirely from `/mcp` (no turn ever opens a browser). `src/core/mcp/oauth/` is the subsystem:

```
pkce.ts       verifier / S256 challenge / state          errors.ts   McpOAuthError, McpAuthRequiredError
request.ts    FetchImpl seam + getJson/postJson/postForm store.ts    0600 atomic store, URL-bound getEntry
discovery.ts  RFC 9728 PRM + RFC 8414 AS metadata        register.ts RFC 7591 dynamic client registration
callback.ts   single-use loopback listener (port 48762)  token.ts    exchange / refresh / revoke
flow.ts       the interactive sequence                   session.ts  runtime token provider
```

```
probe(401 + WWW-Authenticate) → PRM → AS metadata → register (DCR, reused per issuer)
  → consent URL (PKCE S256, resource, optional scope) + open browser
  → loopback callback (state check, iss check) → token exchange → store → reconnect
```

**Why an injected `fetchImpl`.** Every networked module takes `FetchImpl` instead of calling `fetch` directly, so the tests drive the whole authorization-server protocol through a *function* — real `https://` URLs, no TLS server, and no relaxation of the https-only rule. The only real socket in the tests is the loopback callback listener, which the fake `openBrowser` hits exactly like a browser would.

**https only, checked before fetching.** PRM, the AS issuer, and the metadata URL must be `https`; the check runs *before* the request, so a plain-`http` hint is refused without ever being fetched. RFC 8414 §3.3 is enforced too: the metadata's own `issuer` must equal the URL it was fetched from.

**Token storage.** `~/.local/share/lugent/mcp-oauth.json` (from `defaultMcpOAuthPath`, same directory rules as the DB), mode `0600`, written atomically (temp + rename) and re-read + merged before every write so a concurrent writer's other servers survive. Entry keys are the server name, but `getEntry` also requires the stored `serverUrl` to match the one being connected — a project `lugent.json` shadowing a global name must never send the global token. The entry keeps `tokenEndpoint`/`revocationEndpoint` so a refresh needs no second discovery round-trip and `logout` needs no network call to know where to revoke.

**Status and the runtime token provider.** `McpManager` maps `McpAuthRequiredError` to the `auth_required` status (not `failed`: the fix is a sign-in, and `/mcp` offers `authenticate`). `makeTokenProvider` reads the store per request and refreshes **proactively** (60 s of skew) or **forcibly** on a `401`, serialized per server so concurrent requests share one refresh. `invalid_grant`/`invalid_client`/`unauthorized_client` clears the tokens (`auth_required` on the next `/mcp`); any other failure propagates without logging the user out. Tokens live in the store only — `code_verifier` and `state` stay in memory.

`/mcp` actions by `(status, type)` live in one place (`mcpActions` in `src/cli/commands.ts`) so the REPL and the TUI cannot drift: `connected`+remote → logout/disable, `connected`+local → disable, `auth_required` → authenticate/disable, `failed` → reconnect/disable, `disabled` → enable. Ctrl+C during a sign-in cancels the waiting listener (both REPL and TUI) instead of counting toward the double-Ctrl+C exit.

---

Index: [`docs/architecture.md`](../architecture.md)
