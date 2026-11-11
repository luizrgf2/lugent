# add-provider — choosing which models to import

Date: 2026-11-12
Status: design, awaiting approval
Card: `t_54f686c9`
Supersedes on one point: `2026-11-11-add-provider-design.md` ("import every model
from `/models`") and `2026-11-11-add-provider-model-scroll-design.md`, whose
view-only scroll existed *because* the import was all-or-nothing. That reasoning is
reversed by name in the new `docs/decisions/cli-tui.md` entry — the existing one
(`cli-tui.md:166-168`) ends "a checklist would be a new feature with its own
decision", and this is that feature and that decision.

## Intent

`/add-provider` asks the endpoint for its model list and writes **every** id it
advertises into the global config. On a gateway with 200 models — the case the user
hit — that is a bulk import nobody asked for: the cached list is what `/model` shows,
so every junk id, embedding model and dated snapshot lands in the picker the user
scrolls every day.

The demand inverts the contract: **listing is free, importing is a choice.**

Original demand (literal, 2026-11-12):

> no lugent eu quero que o add--provider liste os molos mas na hora que os modelos
> forem listados a gente deve de forma obrigatoria escolher os modelos a se importar
> e não importar todos de forma indiscrminada

Three requirements:

1. the list still comes from the endpoint (Test unchanged: `2xx` + ≥1 id);
2. the import step is **mandatory and explicit** — nothing is written from a list the
   user did not look at;
3. the default is **not** "all of them".

## Goals

- After a passing Test, the model list is a **checklist**, not a preview.
- First run: nothing checked. Re-run: the ids the file already holds are checked, so
  the refresh path preserves the current choice.
- `Enter` writes **exactly the checked ids**, in endpoint order, duplicates included.
- The same selection semantics in both front ends — TUI checklist and `--plain` REPL.
- Update every surface that promises the old contract in plain words.

## Non-goals

- Not changing `discoverModels`, `saveProvider`, `Provider` or the config format.
  `models` stays an optional `string[]`.
- Not touching the Test, the overwrite gate, the masked key reader, the `nomodels`
  branch, `defaultProvider`/`defaultModel`, or the `/model` picker.
- No editing a provider's list without re-running the form.
- No new dependency: TUI stays ink-only, the plain REPL stays ANSI-only via `ui.ts`.
- No truncation of the REPL's printed list — the numbers are its interface, so a long
  list stays fully printed (existing behavior, unchanged).

## Constraints from `AGENTS.md`

| Rule | Consequence |
|---|---|
| `src/core/` zero runtime deps | untouched — **no core file changes at all** |
| `src/cli/` plain stays ANSI-only, no ink | the REPL prints through `ui.ts` and parses a typed answer |
| `src/cli/tui/` may use ink | the checklist is ink, in the component that owns the phase |
| Golden snapshot of `src/core/prompt.ts` | untouched; if it moves, the change is wrong |
| TDD, test next to module, watch it fail | the three test files below, RED first |
| `.agents/skills/git-conventions/SKILL.md` before branch/commit | branch `feat/add-provider-model-selection` already exists off `origin/main`; conventional commits |
| PR is automatic when the branch is ready | push + open PR against `main`, squash |
| Doc updates ship with the code | `README.md`, `docs/architecture/tui.md`, one `docs/decisions/cli-tui.md` entry |
| `docs/specs/` + `docs/plans/` gitignored, never pushed | **not triggered** — this spec lives in `docs/superpowers/specs/`, which is tracked: `git ls-tree origin/main` lists 4 prior spec/plan files there, and `git check-ignore` reports nothing for the path |

### Measured baseline — corrected

`bun test` in a clean checkout of **`origin/main` @ `a8eae3d`**:
**620 pass / 0 fail / 55 files / 3 snapshots / 1565 asserts**, 38 s.

An earlier draft said 460/50. That number came from the main working checkout, which
sits on `feat/paste-tokens` (`f905a1b`), not on `origin/main`. The worktree
`.worktrees/add-provider-select` is the correct baseline source, and 620/55 is what
the plan must return to.

## Approaches considered

**A — the `import` phase becomes a cursor + checkbox list (chosen).**
The phase already windows the list; it gains a cursor, a set of checked indices and
three keys (`space` toggle, `a` all/none, `enter` commit). The window follows the
cursor with `model-picker.tsx:74`'s arithmetic. The REPL gets a counted answer parsed
by one exported pure function. *Trade-off:* it rewrites 9 TUI tests, all 15 REPL
tests (each scripts an answer to the old prompt), and 5 of the 7 app tests — the
other two never reach the import phase, they are the `noModels` branch
(`app.test.tsx:1591`, `:1614`).

**B — a separate reusable `ModelChecklist` component.** Cleaner in the abstract, but
the only caller is this form, which must slot between `test` and `confirm`, report a
count into the footer and share the phase machine. A seam nobody uses, same test cost.
Rejected.

**C — import everything, offer a filter afterwards.** Writes the bulk list to disk
first, which is precisely the indiscriminate import the demand rejects; a crash
between the two writes leaves the 200-model list committed. Rejected.

**A wins** because it is the only approach that never writes what the user did not check.

## The design

### 1. State: selection by **index**, not by id

```ts
const [picked, setPicked] = useState<Set<number>>(new Set())
const pickedRef = useRef(picked)
const setPickedBoth = (next: Set<number>) => { pickedRef.current = next; setPicked(next) }
```

**Indices, not ids.** The endpoint may advertise duplicate ids — the existing render
key is `` `${start + i}-${m}` `` exactly because `key={m}` collided
(`docs/decisions/cli-tui.md`), and `add-provider.tsx:261` keeps it. A `Set<string>`
would toggle both duplicate rows together and `models.filter(m => picked.has(m))`
would write a duplicated id twice. An index set makes each row independently
selectable and the written list exactly the rows checked, in endpoint order.

**Every mutation builds a new Set.** `pickedRef.current.add(i); setPicked(picked)`
passes the same reference and React bails out — the box would never appear while the
ref stayed correct. Toggle is:

```ts
const next = new Set(pickedRef.current)
next.has(i) ? next.delete(i) : next.add(i)
setPickedBoth(next)
```

The refs exist for the ink batching hazard (stale closure inside one batch), not as a
licence to mutate.

`scroll`/`scrollRef` are renamed `sel`/`selRef` — it now selects rather than scrolls.
`MAX_VISIBLE = 8` stays.

### 2. Populating the checklist

In `runTest()` on a passing result:

```ts
const previous = p.storedEntry?.(nameRef.current)?.models ?? []
const fresh = r.models
const keep = new Set<number>()
previous.forEach(id => {
  const i = fresh.indexOf(id)      // first occurrence; a duplicate id keeps one row
  if (i >= 0) keep.add(i)
})
setPickedBoth(keep)
setSelBoth(0)
```

`storedEntry` is the prop the Test already reads the stored key from — no new prop.
First run: no previous list ⇒ **nothing checked**. Re-run: exactly what the file
already holds is checked, so "re-run = refresh" preserves the choice.

**Two halves of the same event — the write differs from the file — and both are
stated.** Ids previously imported that the endpoint no longer advertises cannot
appear in a checklist built from the fresh list, and ids that are advertised but left
unchecked are removed from the file just as surely. One dim line above the rows covers
whichever applies, singular/plural:

```
! removing 2 previously imported models (unchecked)
! 1 previously imported model is no longer advertised
```

Silent data loss is the failure mode this prevents, and both halves are measured
against `previous`.

### 3. Keys in the `import` phase

| Key | Action |
|---|---|
| `↑` / `↓` | cursor one row (clamped to `0..len-1`, no wrap) |
| `PgUp` / `PgDn` | cursor by `MAX_VISIBLE` |
| `Home` / `End` | cursor to `0` / `len-1` |
| `space` | toggle the row under the cursor |
| `a` | check all if any unchecked, else uncheck all |
| `enter` | commit **only if ≥1 checked** |
| `esc` | cancel the form, nothing written (unchanged) |

`space` has no member in ink's `Key` (verified: `node_modules/ink/build/hooks/use-input.d.ts`
declares up/down/left/right/pageUp/pageDown/home/end/return; no `space`), so the branch
tests `input === " "`. It cannot leak into a text field: the `import` phase returns
early (`add-provider.tsx:198`) before the generic `if (input && !k.ctrl …)` write.

**Clamping moves into the setter.** Today `End` sets `scroll = models.length` (`:196`)
and the *render* clamps (`:218`). With a cursor, an out-of-range value makes
`models[selRef.current]` `undefined` on the next `space`. So every movement clamps at
assignment: `setSelBoth(Math.min(selRef.current + d, models.length - 1))`.

**Enter at zero selected is a no-op**, footer reads `select at least one · space toggles`.
"Mandatory" means the write never happens from a list the user did not pick from; a
zero-selection save would be byte-identical to the `nomodels` outcome, which has its own
prompt and its own honest result line. One keystroke must not produce the exact thing
the demand forbids. **`a` keeps the old behavior available as an explicit act.**

### 4. The frame

```
/add-provider · register an OpenAI-compatible provider (saved to the global config)
  name: r
  base url: http://r/v1
  api key: ••••

! removing 2 previously imported models (unchecked)
3 of 20 models selected — 1-8 of 20
❯ [x] model-001
  [ ] model-002
  …

↑/↓ move · space toggle · a all/none · enter import 3 & save · esc cancel
```

- Header replaces `N models found — import all of them?` with `X of N models selected`,
  keeping the `— start-end of total` suffix only when the list exceeds `MAX_VISIBLE`.
- `❯` = cursor, `[x]`/`[ ]` = selection, both inside the existing `<Text>` row, so rows
  per model and the frame height the windowing test measured do not change.
- The id keeps its dim styling; the marker does not, so a checked row reads at a glance.
- Footer carries the count it will write; degrades to `select at least one` at zero.
- Window arithmetic is `model-picker.tsx:74` exactly:
  `start = sel < MAX_VISIBLE ? 0 : sel - MAX_VISIBLE + 1`. With 20 rows one `↓` keeps
  `1-8 of 20` — the window does not move until the cursor passes row 8. That is the
  behavioral difference from today's free scroll and why three window tests change.
- `a list that fits the window shows no scroll hint` stays a real assertion, retargeted
  from `3 models found` to `3 of 3 models selected`.

### 5. `confirm` and `nomodels` — `pendingModelsRef` stays, holding the subset

`commit()` (`:141`) is shared by `import` and `nomodels`; `confirm`'s enter reads
`pendingModelsRef.current` (`:200`) and `nomodels`' backspace resets it (`:184`).
Rather than delete the ref and rebuild a second path, it now carries **the chosen
subset**, and `undefined` keeps its exact meaning ("models-less save"):

```ts
function chosenModels(): string[] {
  return models.filter((_, i) => pickedRef.current.has(i))
}
function submitImport() { commit(chosenModels()) }
```

Because the count is what the user selected, the `confirm` line names it:
`overwrite r? its model list will be replaced by the 3 you selected`. The overwrite
gate, its defaults and its `existing` source are untouched.

### 6. The `--plain` REPL

`add-provider-repl.ts` replaces the `[Y/n]` prompt with a counted one. The list is
already printed as `  ${i + 1}. ${m}`, so numbers are the interface:

```
    1. alpha
    2. * beta
    3. gamma
select models to import (1,3-5 · a all · n cancel · blank keeps *) :
```

`*` marks indices already in the file for this name — the same
`opts.storedEntry(name).models` the Test key path already reads. One exported pure
function, the only parser in the change:

```ts
/**
 * Parse a counted selection into ascending, unique, 0-based indices.
 * `"1,3-5"` → [0,2,3,4]; `"a"`/`"all"` → every index; `" 1 , 3 "` → [0,2];
 * `"5-3"` → [2,3,4] (a reversed range is swapped, not rejected);
 * `"1,1"` → [0] (deduped); `"1,99"` on 3 models → [0] (out of range dropped —
 * silently turning a typo into "the last model" imports what was not named).
 * `""` → [] — meaning depends on the caller, so callers handle blank before
 * calling (see the table below); `null` when a token does not parse or the
 * answer names nothing selectable, so a typo can never read as "empty".
 */
export function parseModelSelection(input: string, count: number): number[] | null
```

Answer handling, in the form (not a helper), bounded and explicit:

| Answer | Result |
|---|---|
| `n` / `N` | `{ status: "cancelled" }` — the explicit cancel, since blank no longer is |
| `a` / `all` | every advertised index |
| blank | the `*` set when non-empty (the re-run "keep current" path); otherwise re-ask |
| `1,3-5` | those indices |
| parses to `[]` or `null` | re-ask |

**The retry loop does not exist today** — `runAddProviderForm` asks each question
exactly once and `askFor` only converts cancellations (`:104-124`). This task adds it:
at most **3 attempts**, then `{ status: "invalid", error: "no valid selection after 3 tries" }`.
Ctrl+C at the prompt still rejects through `askFor` → `cancelled`, which is existing
behavior at the masked key prompt and must survive the loop.

`models` becomes `idx.map(i => found.models[i])` — endpoint order, duplicates
preserved because indices are unique. `AddProviderResult.imported` keeps its meaning
(how many ids this run wrote), so `repl.ts`'s `saved <name> · N models` line is unchanged.

A one-model list still asks: a one-item list has no default either.

### 7. Every surface that promises the old contract

| File:line | Today | After |
|---|---|---|
| `README.md:115` | "writes the provider and **every model id**" · "**Enter still imports all of them, not the visible slice**" | the checked subset; Enter imports exactly what is checked, rows outside the window included |
| `README.md:141` | `# → test → import its models` | `→ test → select models → import` |
| `src/cli/repl.ts:211` | `USAGE = "…tests the endpoint, imports its models"` | `…tests the endpoint, asks which models to import` |
| `src/cli/tui/app.tsx:558` | autocomplete `"register a provider (test + import models)"` | `"register a provider (test + select models)"` |
| `docs/architecture/tui.md` (`add-provider.tsx` entry) | "hands **every** id — never the visible slice" | the checklist, its keys, the zero-selection rule, the removal line |
| `docs/decisions/cli-tui.md` | new entry | reverses `cli-tui.md:166-168` by name; records the strict zero rule, index-not-id, the 3-try REPL bound |
| `add-provider.tsx:22-23, 66-68, 216` | comments asserting "all-or-nothing" / "view-only" | rewritten |

`README.md:66` (`providers.<name>.models` written from the endpoint's `/models`) stays
true and does not change. `README.md:85` contains no all-or-nothing sentence (an earlier
draft of this spec claimed it did); the sentence lives at `:115`.

## Resolved after the builder check

A fresh reviewer read this spec against the code and raised 17 items. What changed:

1. **Baseline corrected** — 620/55 on `origin/main`, not 460/50 (§Constraints).
2. **Test inventory corrected** — 9 TUI tests, 5 of 7 app tests (the other two are
   `noModels`: `app.test.tsx:1591`, `:1614`), all 15 REPL tests.
3. **Every REPL test scripts an import answer**
   (`:47,67,90,106,129,148,175,209,233,252,276,297,316,337,363`) and `scripted()` throws
   on an unexpected prompt — so all 15 get the new answer, not one.
4. **Tests that would pass without the feature** — named explicitly in Risks, per file.
5. **The retry loop is new, not existing** — built here with a 3-attempt bound (§6).
6. **`parseModelSelection` made single-valued** — `""` → `[]`, callers handle blank first;
   `null` is "unparseable", never "empty" (§6).
7. **REPL preselection added** — the `*` marker plus blank-keeps-`*` (§6).
8. **Cursor arithmetic fixed** — `model-picker.tsx:74`, quoted; three window tests change (§4).
9. **Clamping moved into the setter** (§3).
10. **`confirm`/`nomodels` kept working** — `pendingModelsRef` retained, now the subset;
    the overwrite line names the count (§5).
11. **Duplicate ids** — selection is `Set<number>` of indices (§1).
12. **Immutable Set** stated, with the React-bailout reason (§1).
13. **The removal line covers both halves** of data loss (§2).
14. **Preselection has no fixture today** — the two re-run TUI tests return entries with
    no `models`; the plan writes the fixture and its assert from scratch.
15. **Docs targets corrected** — `README.md:115` and `:141` (not `:85`), plus
    `repl.ts:211`, `app.tsx:558` and three stale code comments (§7).
16. **`docs/superpowers/` is tracked, not ignored** — the reviewer flagged committing
    there as an `AGENTS.md` violation; that is wrong, and the constraints table records
    the measurement so the executor does not "fix" it.
17. **"Reusable by both call sites" dropped** — the TUI reads keys, not text (§6).

## What is left to the builder

- Marker glyphs: `[x]`/`[ ]` fixed here (survives a non-UTF-8 locale, reads as a checkbox).
- Exact wording of the removal line beyond the two forms above.
- Whether `PgUp`/`PgDn` keep the `shift+↑/↓` alias the current code has — keep it.

## Risks

- **14 tests encode the old contract** (9 TUI + 5 app), plus all 15 REPL. They are
  rewritten, never deleted: the windowing test still asserts a bounded frame; the
  free-scroll tests become cursor-window tests; `imports every model` inverts into
  `imports exactly the checked rows, including one scrolled out of view`.
- **A rewrite that is green on unfixed code.** `expect(frame).toContain("model-002")`
  passes today (the un-windowed list rendered every id), and so does an app test that
  types `a` then `enter` — the old code swallows `a` in the import phase and imports
  everything, producing an identical assertion. The proving asserts are therefore:
  - **TUI subset:** check exactly one row out of 20, assert `models` equals that single
    id (the old code writes all 20).
  - **TUI mandatory:** `enter` at zero selected writes nothing (`saved.length === 0`) —
    the core requirement, which no test covers today.
  - **TUI window:** after enough `↓` to pass row 8, `not.toContain("model-001")` — the
    old code rendered every id, so presence proves nothing.
  - **REPL subset:** answer `2` on `[alpha, beta]` and assert `models === ["beta"]` —
    the old code treats `2` as "not n" and imports both.
- **A user who wants zero models** and expected the models-less save: blocked by design,
  carried in the issue as the one question for approval.
- **Header wrap on a narrow terminal** growing the frame past the `≤ 20` line budget:
  a `rows: 24` render is the honest place to catch it.
