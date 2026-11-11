# Decisions — Process & docs

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

## 2026-10-23 — logo: SVG in docs + ANSI L-mark in plain REPL + mini mark in TUI status
Decision: `docs/lugent.svg` is the source of truth (README badge); the plain REPL prints an ANSI truecolor L-mark (`logo()` in `ui.ts`, TTY-gated) above the session box; the TUI shows a one-line `▟▙ LUGENT` mark centered in the status bar (amended — initially no TUI logo at all).
Why: terminals can't render SVG without a rasterizer (would break zero-dep); a multi-line logo would eat transcript viewport rows every frame, but the status bar row is already spent — a centered mark there is free.
Cost if wrong: mark is text-only (▟▙ approximates the SVG geometry); a real splash or full logo would need the viewport decision revisited.

## 2026-10-23 — landing page lives at docs/index.html, GitHub Pages serves /docs
Decision: the single-file landing page (`docs/index.html`) is published via GitHub Pages from `main` `/docs`; root-path Pages is not used.
Why: legacy Pages only accepts `/` or `/docs`; from `/` Jekyll renders the repo README over any `site/index.html`, and a `.nojekyll` at root changes nothing for that collision. `/docs` publishes only the docs tree and the page verbatim.
Cost if wrong: `/docs` publishes all of docs/ (architecture.md, decisions.md, future-features.md become public HTML) — acceptable today, but any future internal doc must stay out of docs/ (docs/specs and docs/plans already are, via .gitignore).

---

Index: [`docs/decisions.md`](../decisions.md) — one file per area, chronological within each.

## 2026-10-24 — Docs are split per topic, and the canonical path becomes the index

Decision: every doc that outgrows ~150 lines is split into a folder of one-topic files, and the path it used to live at (`docs/architecture.md`, `docs/decisions.md`) becomes the **index** of that folder — not a stub, not a redirect. `docs/README.md` is the flat map of the tree; `AGENTS.md` keeps the trigger table; `README.md` stays the front door and only carries an `Index:` line into the docs.

Why: the single files had outgrown anything a reader can hold in one pass (architecture 155 lines and rising; the decision log 233 and rising, with the two MCP features alone adding 17 entries), and an append-only log grows by construction. Splitting by topic makes the file you must read the file you were going to change anyway. Keeping the canonical path as the index is what makes the split safe: `src/core/prompt.ts`, the historical specs under `docs/specs/`, and every old commit already point at `docs/decisions.md`. A stub would give a reader a second place to land and go stale the moment a topic file is added; an index cannot, because adding a topic file forces an edit to it.

Cost if wrong: one more level to navigate, and a small topic file now lives in `docs/architecture/foo.md` while its index sits at `docs/architecture.md` — mildly surprising the first time. If the split ever becomes noise, the same rule permits merging the folder back into its index.

## 2026-11-04 — pipeline tasks run in server-created worktrees

Decision: dispatch protocol spawns every pipeline conversation with `worktree: true` — the agent server cuts a dedicated git worktree + branch per conversation under `/tmp/conversation-worktrees/<conversation_id>/`. `worktree: false` only for tasks that explicitly need the main checkout (local-only docs, uncommitted work), and never two of those in parallel.

Why: parallel tasks in the shared `/projects/lugent` checkout clobber each other (index races, one task's branch switch breaks another's build). A worktree per task also contains pipeline git operations — an uncommitted AGENTS.md edit can no longer be wiped by another conversation, because no two conversations share a directory.

Cost if wrong: the child sees only committed `main` at spawn time, so anything uncommitted or gitignored (`docs/specs/`, `docs/plans/`) is invisible to it — briefings must carry what the task needs inline; parallel PRs touching the same files still conflict at merge time (resolved then, not during execution); worktrees accumulate under `/tmp` (ephemeral — fine).


## 2026-11-04 — distribute via npm under Bun; publish from CI on merge to main

Decision: the package ships **unbuilt TypeScript** through npm (`bin` → `src/main.ts` with a `#!/usr/bin/env bun` shebang, `engines.bun >= 1.4`), `files` is an allowlist (`src`, `README.md`, `LICENSE`), and `.github/workflows/publish.yml` runs `bun test` then `npm publish` on every push to `main` — **only when the `package.json` version is not yet on the registry**.

Why: the code is Bun-native end to end (`bun:sqlite`, `Bun.spawn`, `Bun.Glob`), so a Node-targeted build would need a shim layer or a bundler for zero gain; publishing the sources keeps the package the same bytes the tests ran against. The version guard makes merges idempotent: squash-merging a feature without a bump publishes nothing instead of failing the pipeline with a 409. Auth is a granular `NPM_TOKEN` secret written to `~/.npmrc` (`NODE_AUTH_TOKEN` alone is only wired up by `setup-node --registry-url`) because the owner's account forces web-auth 2FA, which a CI runner cannot answer.

Cost if wrong: `npm i -g lugent` is useless without Bun installed (`engines` only warns); a forgotten version bump silently ships nothing — the release is a deliberate act, never a side effect of merging. Rotating the token is manual (revoke on npmjs.com, update the secret).

README images are absolute `raw.githubusercontent.com` URLs inside the tarball-less `docs/` tree: npm cannot resolve relative paths, and shipping the PNGs inside the package just to satisfy the GitHub README would inflate the tarball.

## 2026-11-04 — landing page documents each subsystem in a tab, not one long page

Decision: `docs/index.html` gained a `Features` section built as an ARIA tab set — Agents, Subagents, Skills, MCP, Permissions — with one panel per subsystem, plus a real TUI screenshot. The panels are plain HTML in the markup (no JS templating); the tablist is `display:none` until `document.documentElement.classList.add("js")` runs in `<head>`, and every panel starts **visible** so the no-JS view is the full document with headings, not one panel with four missing.

Why: the page is the public face of the repo and only described a pre-agents lugent (72 tests, seven tools, no MCP/agents/skills/subagents). Tabs keep the man-page layout short while letting each subsystem carry its real detail: file layout, frontmatter, field table, built-ins, the depth-1 and parallel rules, the five OAuth steps. Progressive enhancement is what keeps it honest: a crawler, a reader with JS disabled, or a failed script still gets every panel and every screenshot caption.

Cost if wrong: tab state is `history.replaceState`, so a deep link (`#tab-mcp`) works but there is no per-tab history entry to go back through; if the JS bundle ever fails, readers see all five panels stacked — verbose, never wrong. The screenshot is a captured terminal (fixed width, light-on-dark) and will drift as the chrome line changes; it must be re-captured by hand.

## 2026-11-04 — the site is two surfaces: a short landing page and one page per docs topic

Decision: `docs/index.html` is a short landing page (header, hero, install command, two CTAs, four feature cards, footer). The manual moved to one static page per topic under `docs/<slug>/index.html`, generated by `docs/build.ts` (a plain Bun script, no bundler, no framework), with a shared `docs/site.css`. Pages: getting-started, config, usage, agents, subagents, skills, mcp, permissions, sessions, history, data. Every page carries the same 260px sidebar and prev/next pagination in sidebar order.

Why: the tabbed single page could not grow past five topics and forced every subsystem to compete for one screen. Static folders keep the 2026-10-23 Pages decision intact (`/docs` is served verbatim, no Jekyll, no build step at deploy), keep every page crawlable and deep-linkable, and let a topic gain its own section without touching the others. The generator exists only because the sidebar is 11 identical blocks — it writes committed HTML, so Pages still serves files it never built.

Cost if wrong: adding a page means editing `build.ts` and re-running it, and a forgotten run leaves the committed HTML stale (the generator is the source, the HTML is the artifact — both live in git). Slugs sit in `/docs` next to the repository's own docs (`architecture/`, `decisions/`, `README.md`), so a new topic name must not collide with those; `getting-started/` is used instead of an `index` topic for that reason. There is no search yet, which 11 pages can live without.

All sizes, gaps and colors come from `lugent-landing-design.pen`; the renders in `docs/design/` are exported from it. Body text in the design must use `HEIGHT` + `FILL` autosize — `WIDTH_AND_HEIGHT` does not wrap and escapes its card, which neither `analyze_overlaps` nor `lint` reports.

## 2026-11-04 — the site sits on a starfield, painted below every surface

Decision: a fixed `<canvas id="stars">` (z-index -1, `pointer-events:none`) draws a very dark sky (`--sky: #06070a`) with slowly twinkling stars, on the landing page and every docs page. `docs/site.css` gets the layer and the sky token; `docs/stars.js` owns the drawing. Header and footer became translucent (`rgba(6,7,10,0.72)` + `backdrop-filter: blur(8px)`) so stars drift behind the chrome; cards, code blocks, tables and the sidebar keep their opaque `--surface`.

Why: the design's `#101010` page ground read flat and grey at full-page height. Painting the sky *under* the page, instead of lightening or darkening the page itself, keeps every contrast pair from the design intact: the text colors are unchanged and the surfaces are unchanged — only the empty ground got deeper. The stars are decoration, and the code treats them that way: alpha capped at 0.36, radius ≤ 1.6px, so even the brightest one covers a fraction of a glyph (dim text over the brightest star in the render is still 6.03:1).

Cost if wrong: one more request (`stars.js`, ~5 KB) on 12 pages, one rAF loop that is capped at 30fps and stopped while the tab is hidden; `prefers-reduced-motion` draws a single static frame and never starts the loop (verified by driving Chrome with `--force-prefers-reduced-motion` and diffing two screenshots). If the twinkle ever reads as noise, the fix is one line in `stars.js` (the `TINTS`/`a` range) — no layout depends on it, and the pages render correctly with the script absent, since the sky is the `body` background.

## 2026-11-11 — the site documents `/add-provider` as the alternative to editing the file

Context: `/add-provider` shipped with a full description in `README.md` and zero
mentions anywhere under `docs/` (grep across the generated pages: 0). The docs
site told a newcomer to hand-write `~/.config/lugent/config.json` and stopped
there, so the form was discoverable only from the README.

Decision: three generated pages carry it — `getting-started` ("or skip the JSON"),
`config` (a section with Test / Import / Key / Existing-name rows) and `usage` (one
table row). The manual JSON keeps its place and is introduced first; the form comes
after it. No landing-page card: the landing grid is `repeat(4,1fr)` with exactly
four cards, and the hero already promises any OpenAI-compatible endpoint. The
change edits `docs/build.ts` and commits the regenerated HTML — never the HTML
alone, since `build.ts` rewrites it.

Why: the site is where someone sets lugent up; a setup step that only exists in the
README is invisible from the docs. Three short sections, one per page, keep every
page under the repo's ~150-line ceiling instead of one long provider page.

Cost if wrong: the same facts now live in the README and on three site pages, so a
behavior change has to be applied in two places and can drift. If the `config`
section outgrows the page, it becomes its own `docs/providers/` topic with a
sidebar entry — a change this entry deliberately defers.
