# add-provider in the documentation site — Design

**Status:** awaiting human approval
**Demand (verbatim, pt-BR):** "Agora faça a triagem para voce atualizar o html com a novo recurso add-provider que é uma alternativa do manual adicione no html de documentação faça essa triagem"
**Repo:** `luizrgf2/lugent`
**Base:** `origin/main` @ `5e8b827`
**Card:** `<card-id>`

## Intent

`/add-provider` shipped in code and in `README.md` (PR #33), but the **documentation
site** — the pages under `docs/` served by GitHub Pages — never mentions it. Someone
reading `docs/getting-started/` is told to hand-write `~/.config/lugent/config.json`
and is never told a form can do it. This demand closes that gap: `/add-provider` is
presented as the alternative to the manual edit, on the site.

## What exists today (measured, not assumed)

| Fact | Evidence |
|---|---|
| The command exists | `src/cli/tui/add-provider.tsx`, `src/cli/add-provider-repl.ts` present in `origin/main` |
| `README.md` already documents it | lines 66, 85, 115, 117, 141 of `origin/main:README.md` |
| The docs site does **not** | `grep -c "add-provider"` = **0** on `docs/getting-started/index.html`, `docs/config/index.html`, `docs/usage/index.html`, `docs/agents/index.html` |
| The docs pages are **generated** | `docs/build.ts` (597 lines) writes one `docs/<slug>/index.html` per entry in `PAGES`; `package.json` has no build script — run by hand: `bun docs/build.ts` |
| The build is deterministic | ran `bun docs/build.ts` in a worktree at `origin/main` → `wrote 11 page(s)`, `git status --short` **empty**. Any diff after an edit is exactly the edit. |
| `docs/index.html` (landing) is **not** generated | `build.ts` writes only `join(HERE, p.slug, "index.html")`; the landing page is hand-written HTML (126 lines on `main`) |
| No test covers `docs/` | `git ls-files | grep -i "docs.*test"` → nothing |

## Goals

1. `docs/getting-started/` tells a newcomer that `/add-provider` can write the provider
   entry for them, next to the manual JSON — the manual stays, as the explicit path.
2. `docs/config/` gains a section on adding a provider without editing the file, with
   the facts that matter to a config reader: global file only, key never echoed,
   `{env:VAR}` stored as typed, Test → import models, overwrite asks first,
   no-models save keeps an existing cache.
3. `docs/usage/` lists `/add-provider` in the slash-command table, in the same voice
   as the other rows (one line, what it does).
4. Everything else in the docs tree still builds byte-identically (the generated diff
   touches only the pages the change is about).

## Non-goals

- **Not** changing the command, its behavior or the code — this is docs only.
- **Not** touching `README.md`: it already documents `/add-provider` (line 85 is a
  paragraph; line 115 the slash-command bullet). Verified by grep; a rewrite there is
  a different demand.
- **Not** hand-editing `docs/*/index.html` directly. The pages are generated; editing
  the output would be silently reverted by the next `bun docs/build.ts`. The source of
  truth is `docs/build.ts`.
- **Not** adding a landing-page card (see decision D2).

## Anti-goals

- A page that describes the form in the README's 1,400-word register. The site pages
  are short and scannable (`<section class="sec">` + `<dl class="table">` rows); the
  long-form rationale stays in the README and `docs/architecture/provider.md`.
- Duplicating facts that live elsewhere. `docs/architecture/provider.md` owns
  `discoverModels` internals; the site owes the user the *what*, not the *how*.

## Approaches considered

**A — edit `docs/build.ts` and regenerate (chosen).** The pages are generated from one
typed `PAGES` array; a change is a change to `build.ts` plus a rerun. Cost: three page
bodies get longer, and the regenerated HTML is committed (a large diff of mostly
unchanged files if the build is not deterministic — it is, measured above). This is
the only approach that survives the next build.

**B — hand-edit the generated `docs/*/index.html`.** Cheaper diff to read, but wrong:
`docs/build.ts` is the documented source (its header says "Add a page: append to PAGES,
run again, then commit what it wrote"), and the next regeneration erases the edit. A
page that disagrees with its generator is a trap.

**C — new page `docs/providers/`.** A dedicated topic page for provider setup. Rejected:
the manual path already lives in `getting-started` and `config`; a third page splits the
same topic three ways, which `AGENTS.md` ("one topic per file", ~150-line ceiling)
pushes back on. If the section ever outgrows the config page, promote it then.

## Decisions (mine, recorded so they can be overruled)

- **D1 — three pages, not one.** `getting-started` carries the door ("or let the form
  do it"), `config` carries the detail (what the form writes and keeps), `usage` carries
  the one-line table row. Each page stays under its ~150-line ceiling.
- **D2 — no landing-page card.** The landing `grid` is `repeat(4,1fr)` with exactly
  four cards (`docs/site.css:150`); a fifth would break the column count, and the hero
  already says "Any OpenAI-compatible endpoint". The site's front door is the
  `Documentation →` button; the docs tree is where this belongs.
- **D3 — the manual path stays first.** The demand calls `/add-provider` an
  *alternative* to the manual edit, so the JSON example keeps its place and the form is
  introduced after it. A reader whose file is already hand-written must not be told
  they did it wrong.
- **D4 — facts come from the README, not from the code.** `README.md:85` is the
  authoritative user-facing description of the form's edge cases (masking, `0600`,
  `{env:VAR}` resolution, overwrite prompt, no-models save). The site restates them in
  one or two sentences each; a doc task must not invent behavior the code does not have.

## Constraints (from `AGENTS.md`)

- Docs in English.
- Doc updates ship in the same commit as the code they describe — here, the code *is*
  the doc generator, so `build.ts` and the regenerated `index.html` files go together.
- `docs/specs/` and `docs/plans/` are gitignored and never pushed; this design lives in
  `docs/superpowers/specs/`.
- `.gitignore` has `docs/specs/`, `docs/plans/`, `.superpowers/` — `docs/superpowers/`
  is **not** ignored (verified with `git check-ignore`).

## Plan validation (spike, disposable worktree — no commit, no branch)

The plan was executed for real in a throwaway worktree at `origin/main` (`5e8b827`),
then removed. This is evidence that the plan works, not a delivery.

| Measurement | Result |
|---|---|
| Build at `origin/main`, before any edit | `wrote 11 page(s)`, `git status --short` **empty** |
| Build after the plan's three edits | `wrote 11 page(s)`; `git status` = `docs/build.ts`, `docs/getting-started/index.html`, `docs/config/index.html`, `docs/usage/index.html` — nothing else |
| Diff size | `4 files changed, 26 insertions(+)` |
| Probes | `getting-started` OK · `config` "Add a provider without editing the file" = 1 · `0600` = 1 · `<dt>/add-provider</dt>` = 1 · `docs/agents/index.html` add-provider = **0** |
| Idempotence | second build: `md5sum -c` on all 12 generated pages → **no change**. A rerun produces no diff, so a committed HTML file that disagrees with `build.ts` is a real bug and a cheap one to catch. |
| Sensitivity | deleting **only** the `config` section from `build.ts` dropped that probe to 0 while `getting-started` stayed OK — each task's assert is tied to its own edit, not to the build running at all |
| Page size | 147 / 153 / 164 lines — the ~150-line ceiling is per doc file; these are generated pages one level below the ceiling, and none grew by more than 11 lines |

Two corrections the spike made to the plan as first drafted: the `getting-started` step
originally asserted `grep -c "/add-provider"` = 3, which is wrong because `grep -c`
counts **lines** and the whole paragraph is one line — replaced with a `grep -q` on a
sentence that only exists after the edit. Same class of bug in the "verify" step of
Task 3, which now also asserts the **absence** on a page that must not change.

## Left to the implementer

The exact wording. The spec fixes *what each page must say* and the markers a check can
grep for; the sentences are the implementer's, as long as they match the voice of the
surrounding sections (short declarative, no marketing).
