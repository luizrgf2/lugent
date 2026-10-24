# Decision log

Append-only. Format and inclusion rules: `.agents/skills/git-conventions/SKILL.md`.

## 2026-10-22 — core lib pura + REPL in-process
Decision: v1 is a REPL CLI calling `src/core/` directly; no HTTP server.
Why: one binary, no transport layer to test; HTTP API is a v2 feature with its own trigger.
Cost if wrong: embedding lugent programmatically needs the loop API refactored — core is already UI-free, so surface is small.

## 2026-10-22 — zero runtime dependencies
Decision: stdlib/Bun only (`bun:sqlite`, `Bun.spawn`, `Bun.Glob`, `fetch`); no SDK, no framework.
Why: minimal audit surface, no version churn, Bun covers everything v1 needs.
Cost if wrong: first complex feature (MCP client, real JSON-Schema validation) forces a dep addition — fine, just deliberate.

## 2026-10-22 — append-only store, repaired on read
Decision: messages never edited after insert; `cleanHistory` strips orphan `tool_calls`/results at request time.
Why: aborts and crashes leave assistant calls without result rows; orphans 400 the provider. Repair-on-read keeps the write path trivial.
Cost if wrong: a repair bug silently rewrites what the model saw vs what the DB has — golden e2e pins the wire format.

## 2026-10-22 — outside-project check is pattern-level
Decision: `..` / `~` / absolute-prefix check forces `ask`; no symlink audit.
Why: full path auditing is v1 overkill; pattern check covers the common escapes.
Cost if wrong: a symlink inside the project pointing to a secret becomes readable after one session grant. Upgrade path: real path resolution in `isOutsideProject`.

## 2026-10-22 — deferred: minor review findings F6–F18
Decision: 13 minor findings (401 retry, usage meta, process-group kill, buffer caps, FK pragma, …) left unfixed.
Why: none break core function; fix cost exceeded blast radius at v1.
Cost if wrong: long sessions may hit unbounded shell output (F9) or slow 4xx errors (F6). Full list: git history, commit `fix: review findings F1-F5`.

## 2026-10-22 — internal specs stay off origin
Decision: `docs/specs/` and `docs/plans/` are gitignored; main history was rewritten to drop them before first push.
Why: internal design docs must not reach the public repo.
Cost if wrong: pushing from an old ref (reflog, stale branches) leaks spec blobs. Never revive pre-rewrite refs.

## 2026-10-22 — doc-check enforcement via session.idle, not per-tool
Decision: the end-of-iteration doc check is enforced by an OpenCode plugin (`.opencode/plugins/doc-check`) that marks sessions on write/edit/patch and reminds on `session.idle` — once per mutation batch, 10min cooldown.
Why: per-tool reminder (`tool.execute.after`) fires mid-turn and spams; `session.idle` is the true end-of-implementation trigger. The reminder arrives as a synthetic message the model answers next step.
Cost if wrong: synthetic message wakes the model once more per batch (small token cost); reminder relies on event field shapes from @opencode/plugin 2.1.3 — a breaking event change silently disables it.

## 2026-10-22 — CLI UI: hand-rolled ANSI, not Ink
Decision: all terminal styling (`src/cli/ui.ts`) is hand-rolled — `util.styleText`, raw escapes, box-drawing chars, frame-based spinner. No Ink/ora/chalk/picocolors.
Why: zero runtime dependencies is a declared constraint of the project; `util.styleText` is native in Bun; a REPL needs a small subset (colors, one box, one spinner, per-tool glyphs) that fits ~90 lines. Styling is gated on `isTTY` so piped output stays plain for tests/scripts.
Cost if wrong: no full-screen reactive layout or resize handling — if lugent ever wants panes/full TUI, Ink (what Claude Code uses) is the upgrade, but it breaks the zero-dep constraint and should be its own decision.

## 2026-10-22 — Break zero-dep for the TUI: react + ink
Decision: the CLI TUI layer uses react@19 + ink@8; the pure core (`src/core/`) stays zero-dependency.
Why: full-screen reactive UIs (Claude Code, Gemini CLI, Shopify CLI) are built on React renderers; hand-rolled ANSI cannot do scrollable transcript + fixed composer + dialogs without cursor-math debt. Ink is the most documented choice. The constraint is now scoped to where it buys something (core testability, no supply chain in the engine).
Cost if wrong: ~2-3MB of deps and a React upgrade surface on the CLI layer; if the TUI experiment regresses, `--plain` REPL is the always-working fallback.

## 2026-10-22 — Model reasoning is display-only
Decision: `provider.chat` forwards `delta.reasoning_content` via `onReasoning` for live display; reasoning is never written to the store nor replayed.
Why: persisting it means a message-schema migration for marginal value — reasoning is most useful while streaming, and next-turn history works better with final content only.
Cost if wrong: session replay shows no reasoning (accepted until a replay feature exists); if a provider requires reasoning echoed back in history, a schema change is needed.

## 2026-10-22 — Own ink test harness instead of ink-testing-library
Decision: `src/cli/tui/harness.tsx` renders through ink's real `render()` against fake stdin/stdout; ink-testing-library removed.
Why: ink-testing-library@4 declares `ink: ^5` — on ink v8 it triplicates input events and returns stale frames. The harness is ~40 lines, dev-only, and exercises the production renderer.
Cost if wrong: harness maintenance is ours; replace it when a testing lib with v8 support ships.

## 2026-10-22 — TUI v1: deliberate deferrals from final review
Decision: ship the Ink TUI without (a) deduplicating reasoning across loop iterations, (b) case-insensitive/word answers in permission dialogs, (c) alt-screen mode.
Why: all three are cosmetic edge paths (reasoning repeats only when the model reasons after a tool result; the REPL already accepts `yes`/`always` and caps; scrollback pollution on exit is minor). None blocks the core flow, and each risks touching the just-stabilized input/permission plumbing.
Cost if wrong: minor UX roughness until addressed; revisit when (a) a model streams reasoning mid-tool-loop regularly, (b) users complain about capital Y, (c) scrollback complaints start.

## 2026-10-23 — /resume is scoped by directory; legacy sessions excluded
Decision: sessions store their working directory; `/resume` lists only sessions of the current directory and skips rows created before the column existed (null directory).
Why: cross-directory resumes mix unrelated projects' context and permissions; a null-directory fallback would flood the picker with unscoped legacy rows.
Cost if wrong: databases from before this change never become resumable — acceptable one-time loss; upgrade path is backfilling directory from message metadata if ever needed.

## 2026-10-23 — yolo mode bypasses every permission check, including outside-project
Decision: `/permissions → yolo` makes `runTurn` auto-approve all tool calls — no ask dialogs, no outside-project forced confirmation.
Why: power users want an opt-in fast path; scoping yolo per-tool re-adds the config surface it exists to avoid.
Cost if wrong: one yolo session can read/write outside the project root without any prompt — explicit opt-in only, never a default; status bar shows YOLO while active.

## 2026-10-23 — TUI transcript scroll is tail-clamped window + skipBottom, not per-item virtualization
Decision: transcript keeps rendering only a manual window (`clampItems(items, budget, skipBottom)`); PageUp/PageDown move `skipBottom`, streaming growth is compensated by the same delta while scrolled up (view pin), submit snaps to tail. Markdown parse is LRU-cached (300 entries) and the `Markdown` component is `memo`ized. (Amended: a skip that would swallow the whole transcript — pageUp pressed early in a long stream, where the pin compensation outgrows the item — falls back to the head window, so the view is never blank and the oldest lines stay reachable.)
Why: opencode-style per-item virtualization needs stable item ids + measured heights; ink has neither cheaply. Line-based clamping reuses the existing tail-clamp, renders O(viewport) regardless of history size, and the parse cache removes the O(n²) streaming re-parse.
Cost if wrong: cache misses on straddled slices (clamped texts differ per scroll position) re-parse — bounded by the 300-entry LRU; no arbitrary anchor (scroll is page-quantized only).

## 2026-10-23 — logo: SVG in docs + ANSI L-mark in plain REPL + mini mark in TUI status
Decision: `docs/lugent.svg` is the source of truth (README badge); the plain REPL prints an ANSI truecolor L-mark (`logo()` in `ui.ts`, TTY-gated) above the session box; the TUI shows a one-line `▟▙ LUGENT` mark centered in the status bar (amended — initially no TUI logo at all).
Why: terminals can't render SVG without a rasterizer (would break zero-dep); a multi-line logo would eat transcript viewport rows every frame, but the status bar row is already spent — a centered mark there is free.
Cost if wrong: mark is text-only (▟▙ approximates the SVG geometry); a real splash or full logo would need the viewport decision revisited.

## 2026-10-23 — landing page lives at docs/index.html, GitHub Pages serves /docs
Decision: the single-file landing page (`docs/index.html`) is published via GitHub Pages from `main` `/docs`; root-path Pages is not used.
Why: legacy Pages only accepts `/` or `/docs`; from `/` Jekyll renders the repo README over any `site/index.html`, and a `.nojekyll` at root changes nothing for that collision. `/docs` publishes only the docs tree and the page verbatim.
Cost if wrong: `/docs` publishes all of docs/ (architecture.md, decisions.md, future-features.md become public HTML) — acceptable today, but any future internal doc must stay out of docs/ (docs/specs and docs/plans already are, via .gitignore).

## 2026-10-23 — image attachments: `@path` marker expanded to OpenAI vision parts at turn start
Decision: `@path/to.png` anywhere in the user's message expands (CLI layer, `src/core/images.ts`) into `[{type:"text"},{type:"image_url",image_url:{url:"data:..."}}]` for the newest user message only; the stored message keeps the raw marker text and images are re-read from disk each turn.
Why: one wire format serves every provider behind an OpenAI-compatible proxy (no per-provider code); turn-scoped expansion keeps SQLite schema and session replay untouched; video (`video_url`) was cut — no cross-provider shape exists.
Cost if wrong: image files must keep existing across turns (replay re-reads them); models without vision reject content-parts arrays — the marker stays literal only when the file doesn't resolve, not when the model can't see images.

## 2026-10-23 — Agents: markdown only, no config-file agents
Decision: Agents are `.agents/agents/*.md` files (body = system prompt), mirroring the skills loader; no `agents` key in `lugent.json`.
Why: Long prompts in JSON are unmaintainable, and markdown + frontmatter is already this repo's lived format for skills.
Cost if wrong: Teams wanting agents in one committed config file must add one file per agent instead; the JSONC path of OpenCode stays unimplemented.

## 2026-10-23 — Agents: simple tools list and permission map, no rule engine
Decision: `tools: [...]` plus `permissions: {tool: allow|ask|deny}`. No wildcards, no per-resource patterns, no last-match-wins ordering.
Why: The real use cases (read-only reviewer, shell ask, edit deny) need one flag per tool; the full rule engine stays deferred in `future-features.md`.
Cost if wrong: Policies like "deny `git push`, allow `git status`" are impossible until the rule engine lands; the loader's frontmatter shape stays compatible.

## 2026-10-23 — Per-agent byte-stable prefix, switch invalidates the cache once
Decision: The system prefix is byte-stable within an agent (golden snapshot per fixture), but switching agent mid-session changes the prefix and loses the provider prompt cache for one request.
Why: The agent's system prompt must replace the base prompt to be an agent (OpenCode semantics); keeping the base prompt under it would bloat tokens and defeat read-only agents.
Cost if wrong: Sessions that flip agents often pay a cache miss each switch; a future "reasoning-less prefix" split could isolate the volatile part.

## 2026-10-23 — Built-in agents: `build` (default) and `plan`, compiled into the loader
Decision: `BUILTIN_AGENTS` lives in `agents.ts` and merges *before* the user and project file scopes; `build` reuses `SYSTEM_PROMPT` verbatim and is what `resolveAgent` falls back to (`defaultAgent` unset or unknown); `plan` denies `edit`/`write` and keeps every other tool — `shell` stays permission-controlled.
Why: "always ships with lugent" cannot rely on files — `package.json` publishes `src/` only, so a separate asset tree would need a new shipping mechanism, while a constant arrives with the code and can still be overridden by a same-id file (OpenCode's override rule). Reusing the base prompt keeps the default prefix byte-identical, so nobody pays a cache miss for a feature they didn't ask for, and it gives the "no way back to a plain agent" gap a home: `/agent build`.
Cost if wrong: the built-in prompts are code, so rewording `plan` is a commit unless the user shadows it with their own `plan.md`; `plan` blocks only what a tool list can express — a shell command can still write (`echo > f`), exactly as in OpenCode, so `plan` is a planning guard, not a sandbox.

## 2026-10-23 — Project-scoped agents may grant `allow`; scope restriction deferred
Decision: a project repo can ship `.agents/agents/*.md` with `permissions: {shell: allow}` (and a `defaultAgent` in `lugent.json`), so switching to that agent runs those tools without prompting. Project scope wins over user scope by id, exactly like skills.
Why: project `AGENTS.md` and skills are already trusted-repo channels; a trust prompt or a user-only `allow` rule is a product decision with no user asking for it yet. The `/agent` switch line now reports the resulting toolset, so the widening is visible at the moment it happens.
Cost if wrong: cloning a hostile repo and switching to (or defaulting into) its agent silently widens permissions to whatever that agent allows; the outside-project guard still forces ask for paths outside the project.

## 2026-10-23 — Agent display colors: per-agent `color` field with built-in defaults
Decision: `Agent.color` (optional, frontmatter `color:`) accepts an ink color name or `#rrggbb`; invalid warns and falls back. Built-ins carry defaults (`build` magenta, `plan` yellow) and agents without a color inherit magenta. The TUI shows a fixed context line above the input: yellow `§ AGENTS.md loaded` when a project `AGENTS.md` was read, plus `· agent <id>` in the agent's color.
Why: the user asked "does lugent support per-agent colors?" — it didn't; the status bar already showed the agent id, so the color slot existed visually but not in data. Defaults on built-ins mean the line is colored out of the box; fallback keeps legacy agent files valid without touching them.
Cost if wrong: two agents can pick the same color (no uniqueness check) — acceptable, color is a hint not an identity; hex parsing accepts `#rgb` shorthand ink also accepts, so no divergence.

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
