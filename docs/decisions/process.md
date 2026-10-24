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
