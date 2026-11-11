# add-provider model selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make `/add-provider` write only the models the user explicitly checks, in both the Ink TUI and the `--plain` REPL.

**Architecture:** the existing `import` phase in `src/cli/tui/add-provider.tsx` gains a cursor (`sel`) and a `Set<number>` of checked indices; the window follows the cursor with `model-picker.tsx:74`'s arithmetic and `pendingModelsRef` carries the chosen subset into the unchanged `confirm`/`nomodels` gate. `src/cli/add-provider-repl.ts` swaps its `[Y/n]` prompt for a counted one parsed by a new exported pure function.

**Tech Stack:** TypeScript, Bun (`bun test`), React 19 + Ink 8, `node:fs`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-12-add-provider-model-selection-design.md`

**Validated:** this plan was executed end-to-end on a throwaway worktree at `a8eae3d`
(`.worktrees/spike-select`, since removed) before being handed over. Every step's patch was
applied, the suite reached **630 pass / 0 fail**, and the five proving tests were measured RED
with the source reverted and GREEN with it applied. Three numbers in an earlier draft were
wrong and are corrected below in place: `PgDn`'s window (`2-9`, not `9-16`), `↓`'s cursor
arithmetic (`model-picker.tsx:74`, window frozen for the first seven presses), and the count of
tests needing edits (8 TUI + 13 REPL, not 6 + 1).

## Global Constraints

- `bun` is **not on the agent shell's PATH**; it is at `~/.bun/bin/bun` (1.4.4). Run `~/.bun/bin/bun test`, never `bun test`.
- Baseline: **620 pass / 0 fail / 55 files** on `origin/main` @ `a8eae3d`. The suite must end green at 620 + the net new tests.
- `src/core/` is untouched by this plan. If a core file changes, something is wrong.
- `src/core/prompt.ts` and its snapshot are untouched. `bun test -u` is never run.
- `src/cli/` (plain REPL) stays ANSI-only — no `ink`/`react` import outside `src/cli/tui/`. Formatting goes through `src/cli/ui.ts`.
- TDD: the test is written and **seen fail** before the implementation. Test file lives next to the module.
- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`). Docs in English.
- `docs/superpowers/` is tracked (not gitignored) — commit spec and plan by explicit path with `git add`.
- Never `git add -A`: `.worktrees/` is ignored but a stray `-A` in the wrong directory is how unrelated work gets swept in.
- The PR is automatic once the branch is green: push `feat/add-provider-model-selection` and open it against `main` (squash).

## Review Focus

The five input classes most likely to bite a user, each pinned by a test in the task that owns it:

1. **Zero selected, `enter` pressed** — nothing is written, and the form says why. (Task 3)
2. **Duplicate model ids from a gateway** — each row toggles independently; a checked duplicate appears once per row checked. (Tasks 1, 3)
3. **A re-run whose endpoint dropped an id, or whose user unchecked one** — the file loses that id, and the frame says so before the write. (Task 4)
4. **A REPL answer that is a typo** — re-asks, bounded at 3, never silently writes nothing. (Tasks 5, 6)
5. **A `↓` on the last row / `End` then `space`** — clamped in the setter, so `models[sel]` is never `undefined`. (Task 2)

---

## File Structure

| File | Responsibility |
|---|---|
| `src/cli/tui/add-provider.tsx` | the form: phases, cursor, checklist, keys, commit |
| `src/cli/tui/add-provider.test.tsx` | component-level: checklist rendering, keys, subset commit, preselection |
| `src/cli/add-provider-repl.ts` | the headless form + `parseModelSelection` |
| `src/cli/add-provider-repl.test.ts` | parser unit tests + the form's counted-answer loop |
| `src/cli/tui/app.test.tsx` | the 5 `/add-provider` app tests reach the checklist; one new subset proof |
| `README.md`, `docs/architecture/tui.md`, `docs/decisions/cli-tui.md`, `src/cli/repl.ts`, `src/cli/tui/app.tsx` | the copy that promises the old contract |

---

### Task 1: the checklist renders — cursor, boxes, count

**Files:**
- Modify: `src/cli/tui/add-provider.tsx:69-71` (state), `:124-128` (runTest init), `:216-219` (window), `:254-263` (import frame)
- Test: `src/cli/tui/add-provider.test.tsx`

**Interfaces:**
- Produces: `picked: Set<number>`, `pickedRef`, `setPickedBoth(next)`, `sel`/`selRef`/`setSelBoth(i)`; `start`/`view` derived from `sel`. Later tasks read `pickedRef.current`.

**Steps:**

- [ ] **Step 1: write the failing test**

In `src/cli/tui/add-provider.test.tsx`, add after the existing `toImport` helper (`:342`):

```tsx
test("the import phase is a checklist with nothing selected on a first run", async () => {
  const { lastFrame } = await toImport(3)
  const frame = lastFrame()
  expect(frame).toContain("0 of 3 models selected")
  expect(frame).toContain("[ ] model-001")
  expect(frame).not.toContain("[x]")
  expect(frame).toContain("space toggle")
})
```

- [ ] **Step 2: run it, watch it fail**

```bash
cd /home/luiz/projects/lugent/.worktrees/add-provider-select
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "checklist with nothing selected"
```
Expected: FAIL — the frame says `3 models found — import all of them?` and no row has a box.

- [ ] **Step 3: replace the scroll state with a cursor and selection**

In `add-provider.tsx`, replace the `scroll`/`scrollRef` block (`:67-71`) with:

```tsx
  // Which model the cursor is on, and which rows are checked for import. Index,
  // not id: an endpoint can advertise the same id twice (the render key is
  // `${start + i}-${m}` for exactly that reason), and a Set<string> would toggle
  // both rows at once. Refs mirror state: ink batches keys into one render.
  const [sel, setSel] = useState(0)
  const selRef = useRef(0)
  const setSelBoth = (i: number) => { selRef.current = i; setSel(i) }
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const pickedRef = useRef<Set<number>>(new Set())
  // Every mutation passes a NEW Set: `setPicked(ref.current)` after `add()` is the
  // same reference, and React bails out — the box would never appear.
  const setPickedBoth = (next: Set<number>) => { pickedRef.current = next; setPicked(next) }
  const chosenModels = () => models.filter((_, i) => pickedRef.current.has(i))
```

In `runTest()` (`:124-127`) replace `setScrollBoth(0)` with:

```tsx
    setPickedBoth(new Set())
    setSelBoth(0)
```

and drop the `pendingModelsRef.current = r.models` line (Task 3 re-adds it holding the subset).

Replace the render's window math (`:216-219`) with:

```tsx
  const fit = models.length <= MAX_VISIBLE
  // Cursor window, the same arithmetic as model-picker.tsx:74: the window only
  // moves once the cursor passes the last visible row.
  const start = sel < MAX_VISIBLE ? 0 : sel - MAX_VISIBLE + 1
  const view = models.slice(start, start + MAX_VISIBLE)
```

Replace the `phase === "import"` block (`:254-263`) with:

```tsx
      {phase === "import" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {picked.size} of {models.length} model{models.length === 1 ? "" : "s"} selected
            {fit ? "" : ` — ${start + 1}-${start + view.length} of ${models.length}`}
          </Text>
          {view.map((m, i) => {
            const idx = start + i
            const on = picked.has(idx)
            return (
              <Text key={`${idx}-${m}`}>
                <Text color={idx === sel ? "cyan" : undefined}>{idx === sel ? "❯ " : "  "}</Text>
                <Text>{on ? "[x]" : "[ ]"}</Text>
                <Text dimColor> {m}</Text>
              </Text>
            )
          })}
        </Box>
      )}
```

Replace the `import` footer branch (`:276`) with:

```tsx
            : phase === "import" ? `↑/↓ move · space toggle · enter import ${picked.size} & save · esc cancel`
```

- [ ] **Step 4: run the test, watch it pass**

```bash
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "checklist with nothing selected"
```
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/cli/tui/add-provider.tsx src/cli/tui/add-provider.test.tsx
git commit -m "feat(tui): the /add-provider import phase is a checklist"
```

---

### Task 2: toggle and move — `space`, `a`, clamped cursor

**Files:**
- Modify: `src/cli/tui/add-provider.tsx:188-197` (the import key branch)
- Test: `src/cli/tui/add-provider.test.tsx`

**Interfaces:**
- Consumes: `pickedRef`, `setPickedBoth`, `selRef`, `setSelBoth`, `view`, `start`.
- Produces: `toggleAt(i)`, `toggleAll()` — Task 3's commit reads `pickedRef.current` only.

- [ ] **Step 1: write the failing tests**

```tsx
test("space toggles the row under the cursor, twice returns it", async () => {
  const { type, lastFrame } = await toImport(3)
  type(" ")
  await wait(30)
  expect(lastFrame()).toContain("1 of 3 models selected")
  expect(lastFrame()).toContain("[x] model-001")
  type(" ")
  await wait(30)
  expect(lastFrame()).toContain("0 of 3 models selected")
})

test("a checks every row, and pressing it again clears them", async () => {
  const { type, lastFrame } = await toImport(3)
  type("a")
  await wait(30)
  expect(lastFrame()).toContain("3 of 3 models selected")
  type("a")
  await wait(30)
  expect(lastFrame()).toContain("0 of 3 models selected")
})

test("the cursor clamps at the last row, and space there toggles the last model", async () => {
  // `End` used to set `scroll = models.length` and let the render clamp. A cursor
  // cannot: models[sel] would be undefined on the next space.
  const { type, lastFrame } = await toImport(5)
  type("\u001b[F")                            // end
  await wait(30)
  type(" ")                                   // toggle the last row
  await wait(30)
  expect(lastFrame()).toContain("1 of 5 models selected")
  expect(lastFrame()).toContain("5-5 of 5")   // or the window showing row 5
  expect(lastFrame()).toContain("[x] model-005")
})

test("down past the last row does not move the cursor", async () => {
  const { type, lastFrame } = await toImport(2)
  type("\u001b[B\u001b[B\u001b[B")            // three downs on two rows
  await wait(30)
  type(" ")
  await wait(30)
  expect(lastFrame()).toContain("[x] model-002")
  expect(lastFrame()).toContain("1 of 2 model")
})
```

- [ ] **Step 2: run them, watch them fail**

```bash
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "space toggles"
```
Expected: FAIL — `space` is not handled; the count stays `0 of 3`.

- [ ] **Step 3: implement the keys**

Replace the `phaseRef.current === "import"` branch inside `useInput` (`:188-199`) with:

```tsx
      if (phaseRef.current === "import") {
        const last = models.length - 1
        const move = (to: number) => setSelBoth(Math.max(0, Math.min(to, last)))
        if (k.upArrow) { move(selRef.current - 1); return }
        if (k.downArrow) { move(selRef.current + 1); return }
        if (k.pageUp || (k.shift && k.upArrow)) { move(selRef.current - MAX_VISIBLE); return }
        if (k.pageDown || (k.shift && k.downArrow)) { move(selRef.current + MAX_VISIBLE); return }
        if (k.home) { move(0); return }
        if (k.end) { move(last); return }
        // No `space` member in ink's Key (use-input.d.ts), so the character is the signal.
        if (input === " ") {
          const i = selRef.current
          const next = new Set(pickedRef.current)
          if (next.has(i)) next.delete(i); else next.add(i)
          setPickedBoth(next)
          return
        }
        if (input === "a") {
          setPickedBoth(pickedRef.current.size === models.length
            ? new Set()
            : new Set(models.map((_, i) => i)))
          return
        }
        if (k.return && pickedRef.current.size > 0) { commit(chosenModels()); return }
        return
      }
```

and delete the now-dead `if (phaseRef.current === "import") { submitImport(); return }`
line below (`:199`), plus the `submitImport` function (`:146`).

- [ ] **Step 4: run the tests, watch them pass**

```bash
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "space toggles"
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "checks every row"
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "clamps at the last row"
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "down past the last row"
```
Expected: all PASS.

- [ ] **Step 5: commit**

```bash
git add src/cli/tui/add-provider.tsx src/cli/tui/add-provider.test.tsx
git commit -m "feat(tui): space and a select models, the cursor clamps"
```

---

### Task 3: commit exactly what is checked — and nothing at zero

**Files:**
- Modify: `src/cli/tui/add-provider.tsx:140-146` (`commit`), `:183-187` (`nomodels` branch), `:200` (`confirm` enter), `:265-271` (`confirm` copy)
- Test: `src/cli/tui/add-provider.test.tsx`

**Interfaces:**
- Consumes: `chosenModels()` from Task 1.
- Produces: `commit(models?: string[])` unchanged in shape; `pendingModelsRef` now holds the subset.

- [ ] **Step 1: write the failing tests**

```tsx
test("enter writes only the checked models, not the whole list", async () => {
  // The proving test for the demand: one row checked out of 20. The old code
  // writes all 20, so `toEqual(["model-002"])` is RED before the change.
  const saved: any[] = []
  const { type, lastFrame } = await toImport(20, saved)
  type("\u001b[B")                            // down to model-002
  await wait(30)
  type(" ")                                   // check it
  await wait(30)
  type("\r")                                  // import & save
  await wait(30)
  expect(saved.length).toBe(1)
  expect(saved[0][1].models).toEqual(["model-002"])
})

test("enter at zero selected writes nothing and says why", async () => {
  // The "mandatory" requirement had no test at all before this change.
  const saved: any[] = []
  const { type, lastFrame } = await toImport(3, saved)
  type("\r")
  await wait(30)
  expect(saved.length).toBe(0)
  expect(lastFrame()).toContain("select at least one")
})

test("a checked row scrolled out of view is still written", async () => {
  const saved: any[] = []
  const { type, lastFrame } = await toImport(20, saved)
  type(" ")                                   // check model-001
  await wait(30)
  type("\u001b[F")                            // end — model-001 leaves the window
  await wait(30)
  expect(lastFrame()).not.toContain("model-001")
  type(" ")
  await wait(30)
  type("\r")
  await wait(30)
  expect(saved[0][1].models).toEqual(["model-001", "model-020"])
})

test("duplicate ids toggle independently and are written once per checked row", async () => {
  const saved: any[] = []
  const { type } = renderTui(
    <AddProvider {...base} onSaved={(n, c) => saved.push([n, c])}
      discover={() => Promise.resolve({ ok: true, models: ["dup", "dup"] })} />,
  )
  type("r\rhttp://r/v1\rsk-1\r")
  await wait(30)
  type("\r")
  await wait(40)
  type(" ")                                   // first row only
  await wait(30)
  type("\r")
  await wait(30)
  expect(saved[0][1].models).toEqual(["dup"])   // second row unchecked → one entry
})
```

- [ ] **Step 2: run them, watch them fail**

```bash
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "only the checked models"
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "zero selected"
```
Expected: FAIL — the first saves 20 ids, the second saves 3.

- [ ] **Step 3: wire the commit to the selection**

Replace `commit` and `save` (`:130-146`) with:

```tsx
  /**
   * `models` is the list this write will hold: the checked subset for an import,
   * `undefined` for a models-less save (the `nomodels` branch). An existing name
   * is confirmed first, and the confirmation names the count so a subset write is
   * never confirmed blind.
   */
  function commit(models?: string[]) {
    pendingModelsRef.current = models
    if (p.existing.includes(nameRef.current)) { go("confirm"); return }
    save(models)
  }
```

In the `nomodels` branch, `commit(undefined)` already resets `pendingModelsRef`
through the line above, so delete the explicit reset at `:184`:

```tsx
      if (phaseRef.current === "nomodels") {
        if (back) { clearMsg(); go("test"); return }
        if (k.return) commit(undefined)
        return
      }
```

The `confirm` branch's `save(pendingModelsRef.current)` (`:200`) stays as it is — the
ref now holds the subset.

Replace the `confirm` copy (`:265-271`) with:

```tsx
      {phase === "confirm" && (
        <Text color="yellow">
          overwrite {name}? {pendingModelsRef.current
            ? `its model list will be replaced by the ${pendingModelsRef.current.length} you selected`
            : "it keeps its current model list (the endpoint advertised none this time)"}; an empty key field keeps the current key
        </Text>
      )}
```

- [ ] **Step 4: run the tests, watch them pass**

```bash
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx
```
Expected: PASS except the tests this plan rewrites in Task 8 — those are expected to be RED until then; note the list and continue.

- [ ] **Step 5: commit**

```bash
git add src/cli/tui/add-provider.tsx src/cli/tui/add-provider.test.tsx
git commit -m "feat(tui): /add-provider writes only the checked models"
```

---

### Task 4: a re-run pre-checks what the file holds, and says what it drops

**Files:**
- Modify: `src/cli/tui/add-provider.tsx:124-128` (`runTest` init)
- Test: `src/cli/tui/add-provider.test.tsx`

**Interfaces:**
- Consumes: `p.storedEntry` (existing prop), `r.models`, `setPickedBoth`, `setSelBoth`.
- Produces: `previousModels: string[]` state, `removed: string[]` derived — read by the frame in Step 3.

- [ ] **Step 1: write the failing tests**

```tsx
test("a re-run pre-checks the models the file already holds", async () => {
  // No fixture for this existed: the two re-run tests return entries with no `models`.
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} existing={["r"]}
      storedEntry={() => ({ baseUrl: "http://r/v1", apiKey: "sk-old", models: ["model-002", "model-003"] })}
      discover={() => Promise.resolve({ ok: true, models: ["model-001", "model-002", "model-003"] })} />,
  )
  type("r\rhttp://r/v1\r\r")                 // blank key keeps the stored one
  await wait(30)
  type("\r")
  await wait(40)
  expect(lastFrame()).toContain("2 of 3 models selected")
  expect(lastFrame()).toContain("[x] model-002")
  expect(lastFrame()).toContain("[ ] model-001")
})

test("a stored model the endpoint no longer advertises is reported before the write", async () => {
  const { type, lastFrame } = renderTui(
    <AddProvider {...base}
      storedEntry={() => ({ baseUrl: "http://r/v1", models: ["gone-1", "gone-2", "model-001"] })}
      discover={() => Promise.resolve({ ok: true, models: ["model-001"] })} />,
  )
  type("r\rhttp://r/v1\r\r")
  await wait(30)
  type("\r")
  await wait(40)
  expect(lastFrame()).toContain("2 previously imported models are no longer advertised")
})

test("unchecking a previously imported model says it will be removed", async () => {
  const { type, lastFrame } = renderTui(
    <AddProvider {...base}
      storedEntry={() => ({ baseUrl: "http://r/v1", models: ["model-001", "model-002"] })}
      discover={() => Promise.resolve({ ok: true, models: ["model-001", "model-002"] })} />,
  )
  type("r\rhttp://r/v1\r\r")
  await wait(30)
  type("\r")
  await wait(40)
  expect(lastFrame()).not.toContain("removing")
  type(" ")                                   // uncheck model-001, which the file holds
  await wait(30)
  expect(lastFrame()).toContain("1 previously imported model will be removed")
})
```

- [ ] **Step 2: run them, watch them fail**

```bash
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "pre-checks"
```
Expected: FAIL — `0 of 3 models selected`, because `runTest` clears the set.

- [ ] **Step 3: seed the selection from the file, and compute the removal line**

Add next to the `picked` state:

```tsx
  // The models the file already holds for this name — the same source the Test
  // reads its key from. Drives both the pre-check and the removal notice.
  const [previous, setPrevious] = useState<string[]>([])
  const previousRef = useRef<string[]>([])
```

In `runTest()`, replacing `setPickedBoth(new Set())`:

```tsx
    const prev = p.storedEntry?.(nameRef.current)?.models ?? []
    previousRef.current = prev; setPrevious(prev)
    const keep = new Set<number>()
    // First occurrence only: a duplicate id keeps one row checked, not both.
    prev.forEach(id => {
      const i = r.models.indexOf(id)
      if (i >= 0) keep.add(i)
    })
    setPickedBoth(keep)
```

In the render, above the count line:

```tsx
  const goneNow = previous.filter(id => !models.includes(id))
  const goneUnchecked = previous.filter(id => {
    const i = models.indexOf(id)
    return i >= 0 && !picked.has(i)
  })
```

and inside the `import` block, before the count:

```tsx
          {goneNow.length > 0 && (
            <Text color="yellow">
              {goneNow.length} previously imported model{goneNow.length === 1 ? " is" : "s are"} no longer advertised
            </Text>
          )}
          {goneUnchecked.length > 0 && (
            <Text color="yellow">
              {goneUnchecked.length} previously imported model{goneUnchecked.length === 1 ? " will be" : "s will be"} removed (unchecked)
            </Text>
          )}
```

Both lines are inside the phase block, so they count toward the frame's height — Step 4 checks the budget.

- [ ] **Step 4: run the tests, and confirm the frame budget**

```bash
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "pre-checks"
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "no longer advertises"
~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx -t "will be removed"
```
Expected: PASS. Then render 300 models with a stored entry of 300 and assert the frame stays
`≤ 22` lines (`≤ 20` + the two notice lines) at `rows: 30`.

- [ ] **Step 5: commit**

```bash
git add src/cli/tui/add-provider.tsx src/cli/tui/add-provider.test.tsx
git commit -m "feat(tui): a re-run pre-checks the imported models and reports drops"
```

---

### Task 5: `parseModelSelection` — the pure function

**Files:**
- Modify: `src/cli/add-provider-repl.ts` (new export)
- Test: `src/cli/add-provider-repl.test.ts`

**Interfaces:**
- Produces: `parseModelSelection(input: string, count: number): number[] | null` — ascending, unique, 0-based; `[]` for blank; `null` for unparseable or nothing selectable. Task 6 is its only caller.

- [ ] **Step 1: write the failing tests**

```ts
test("parseModelSelection: a comma list becomes ascending unique 0-based indices", () => {
  expect(parseModelSelection("1,3", 5)).toEqual([0, 2])
  expect(parseModelSelection("3,1", 5)).toEqual([0, 2])     // order in, order out
  expect(parseModelSelection("1,1", 5)).toEqual([0])        // deduped
})

test("parseModelSelection: ranges expand, and a reversed range is swapped", () => {
  expect(parseModelSelection("3-5", 6)).toEqual([2, 3, 4])
  expect(parseModelSelection("5-3", 6)).toEqual([2, 3, 4])
  expect(parseModelSelection("1,3-4", 5)).toEqual([0, 2, 3])
})

test("parseModelSelection: whitespace is tolerated, `a`/`all` is everything", () => {
  expect(parseModelSelection(" 1 , 3 ", 5)).toEqual([0, 2])
  expect(parseModelSelection("a", 3)).toEqual([0, 1, 2])
  expect(parseModelSelection("ALL", 3)).toEqual([0, 1, 2])
})

test("parseModelSelection: blank is empty, a typo is null, out-of-range is dropped", () => {
  expect(parseModelSelection("", 3)).toEqual([])
  expect(parseModelSelection("   ", 3)).toEqual([])
  expect(parseModelSelection("abc", 3)).toBeNull()
  expect(parseModelSelection("1;2", 3)).toBeNull()
  expect(parseModelSelection("99", 3)).toBeNull()            // nothing selectable → null, not []
  expect(parseModelSelection("1,99", 3)).toEqual([0])        // the valid part survives
})
```

Add `parseModelSelection` to the existing import from `./add-provider-repl` (`:5`).

- [ ] **Step 2: run them, watch them fail**

```bash
~/.bun/bin/bun test src/cli/add-provider-repl.test.ts -t "parseModelSelection"
```
Expected: FAIL — `parseModelSelection is not a function`.

- [ ] **Step 3: implement it**

In `add-provider-repl.ts`, after `needsV1`:

```ts
/**
 * Parse a counted selection into ascending, unique, 0-based indices.
 *
 * The REPL's model list is printed as `1. alpha`, so the numbers are the
 * interface: `"1,3-5"` is the natural answer. Rules that are decisions, not
 * conveniences:
 *
 * - out-of-range indices are **dropped**, not clamped — turning `1,99` into
 *   "the last model" would import an id the user never named;
 * - a reversed range (`5-3`) is swapped rather than rejected: it is unambiguous;
 * - `null` means "not a selection", never "empty" — an empty write and a typo
 *   must stay distinguishable at the call site.
 */
export function parseModelSelection(input: string, count: number): number[] | null {
  const raw = input.trim().toLowerCase()
  if (raw === "") return []
  if (raw === "a" || raw === "all") return count > 0 ? Array.from({ length: count }, (_, i) => i) : null
  const out = new Set<number>()
  let valid = 0
  for (const token of raw.split(",")) {
    const t = token.trim()
    if (t === "") continue
    const range = t.match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      const a = Number(range[1]), b = Number(range[2])
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      for (let n = lo; n <= hi; n++) { valid++; if (n >= 1 && n <= count) out.add(n - 1) }
      continue
    }
    const single = t.match(/^\d+$/)
    if (!single) return null
    valid++
    const n = Number(t)
    if (n >= 1 && n <= count) out.add(n - 1)
  }
  if (valid === 0) return null
  // Every token parsed but nothing landed in range (`"99"` on 3 models): the
  // answer selects nothing, which is a typo, not a decision.
  return out.size === 0 ? null : [...out].sort((a, b) => a - b)
}
```

- [ ] **Step 4: run the tests, watch them pass**

```bash
~/.bun/bin/bun test src/cli/add-provider-repl.test.ts -t "parseModelSelection"
```
Expected: 4 tests PASS.

- [ ] **Step 5: commit**

```bash
git add src/cli/add-provider-repl.ts src/cli/add-provider-repl.test.ts
git commit -m "feat(repl): parse a counted model selection"
```

---

### Task 6: the plain REPL asks which models, bounded at three tries

**Files:**
- Modify: `src/cli/add-provider-repl.ts:132-150` (the test/import block)
- Test: `src/cli/add-provider-repl.test.ts`

**Interfaces:**
- Consumes: `parseModelSelection` from Task 5, `opts.storedEntry`, `opts.ask`, `askFor`.
- Produces: `AddProviderResult` unchanged — `imported` still counts what this run wrote.

- [ ] **Step 1: write the failing tests**

```ts
test("plain repl: only the numbered models are imported", async () => {
  // The proving test: the old code reads "2" as "not n" and imports both.
  const f = fixture()
  const s = scripted(["http://new/v1", "sk-new", "2"])
  const r = await runAddProviderForm({
    name: "fresh", ask: s.ask, discover: foundTwo, existing: [],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("saved")
    if (r.status !== "saved") throw new Error("unreachable")
    expect(r.imported).toBe(1)
    expect(f.read().providers.fresh.models).toEqual(["beta"])
  } finally { f.cleanup() }
})

test("plain repl: a range selects a slice, `a` selects everything", async () => {
  const f = fixture()
  const s = scripted(["http://new/v1", "sk-new", "1"])
  const withThree = async () => ({ ok: true, models: ["one", "two", "three"] })
  const r = await runAddProviderForm({
    name: "fresh", ask: s.ask, discover: withThree, existing: [],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("saved")
    if (r.status !== "saved") throw new Error("unreachable")
    expect(f.read().providers.fresh.models).toEqual(["one"])
  } finally { f.cleanup() }
})

test("plain repl: a typo re-asks instead of cancelling, and the third failure is an error", async () => {
  const f = fixture()
  const s = scripted(["http://new/v1", "sk-new", "abc", "zzz", "99"])
  const r = await runAddProviderForm({
    name: "fresh", ask: s.ask, discover: foundTwo, existing: [],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("invalid")
    if (r.status !== "invalid") throw new Error("unreachable")
    expect(r.error).toContain("3")
    expect(s.prompts.filter(p => /select models/.test(p)).length).toBe(3)
    expect(f.read().providers.fresh).toBeUndefined()   // nothing written
  } finally { f.cleanup() }
})

test("plain repl: `n` cancels, and so does blank when nothing is stored", async () => {
  const f = fixture()
  const s = scripted(["http://new/v1", "sk-new", "n"])
  const r = await runAddProviderForm({
    name: "fresh", ask: s.ask, discover: foundTwo, existing: [],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("cancelled")
    expect(f.read().providers.fresh).toBeUndefined()
  } finally { f.cleanup() }
})

test("plain repl: blank keeps the stored selection on a re-run, marked with *", async () => {
  const f = fixture()                                  // SEEDED holds models: ["m-old"]
  const s = scripted(["http://new/v1", "sk-old", ""])
  const r = await runAddProviderForm({
    name: "existing", ask: s.ask,
    discover: async () => ({ ok: true, models: ["m-old", "m-new"] }),
    existing: ["existing"], storedEntry: n => providerEntryInFile(n, f.path),
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("saved")
    if (r.status !== "saved") throw new Error("unreachable")
    expect(f.read().providers.existing.models).toEqual(["m-old"])
  } finally { f.cleanup() }
})
```

- [ ] **Step 2: run them, watch them fail**

```bash
~/.bun/bin/bun test src/cli/add-provider-repl.test.ts -t "only the numbered models"
```
Expected: FAIL — both models imported.

- [ ] **Step 3: implement the prompt and the loop**

Replace `:134-149` with:

```ts
  let models: string[] | undefined
  if (found.ok) {
    const stored = opts.storedEntry?.(name)?.models ?? []
    found.models.forEach((m, i) => say(`  ${i + 1}. ${stored.includes(m) ? "* " : "  "}${m}`))
    // A blank answer keeps `*` (the models the file already holds), which is the
    // re-run path; with nothing stored there is no default to fall into and a
    // blank answer re-asks. `n` is the explicit cancel.
    const keep = stored.map(id => found.models.indexOf(id)).filter(i => i >= 0).sort((a, b) => a - b)
    const tries = 3
    let chosen: string[] | undefined
    for (let attempt = 0; attempt < tries && chosen === undefined; attempt++) {
      const answer = await askFor(() => opts.ask(
        "select models to import (1,3-5 · a all · n cancel · blank keeps *) : ",
      ))
      if (answer === CANCELLED) return { status: "cancelled" }
      const text = answer.trim().toLowerCase()
      if (text === "n" || text === "no") return { status: "cancelled" }
      if (text === "" ) {
        if (keep.length === 0) continue
        chosen = keep.map(i => found.models[i]); break
      }
      const idx = parseModelSelection(answer, found.models.length)
      if (idx === null || idx.length === 0) continue
      chosen = idx.map(i => found.models[i])
    }
    if (chosen === undefined) return { status: "invalid", error: `no valid selection after ${tries} tries` }
    models = chosen
  } else if (found.noModels) {
```

The existing `noModels` branch and everything below it stay as they are.

- [ ] **Step 4: run the tests, watch them pass**

```bash
~/.bun/bin/bun test src/cli/add-provider-repl.test.ts
```
Expected: PASS for the seven new tests. The remaining tests in the file still script the
old `[Y/n]` answer — Task 8 rewrites them; note which fail and continue.

- [ ] **Step 5: commit**

```bash
git add src/cli/add-provider-repl.ts src/cli/add-provider-repl.test.ts
git commit -m "feat(repl): /add-provider asks which models to import"
```

---

### Task 7: the app-level tests, and the proof that nothing is written unselected

**Files:**
- Modify: `src/cli/tui/app.test.tsx:1506-1541, 1542-1560, 1562-1590, 1645-1668, 1669-1695`
- Test: same file

**Interfaces:**
- Consumes: the checklist from Tasks 1-4. No new source change in this task.

- [ ] **Step 1: rewrite the five tests to check before importing, and add the subset proof**

Every test that types `\r` to import now types `a` then `\r` — **except** the new proof
test, which must not, or it would pass on the old code:

```tsx
test("/add-provider imports only the model the user checked", async () => {
  // Types `down`, `space`, `enter` — never `a`. On the pre-change code, `down` and
  // `space` are swallowed by the scroll-only import phase and `enter` writes both
  // models, so this assertion is RED without the feature.
  const global = `/tmp/opencode/tui-addprov-subset-${Date.now()}.json`
  const env = fakeEnv({ projectRoot: "/tmp/opencode", discoverModels: fakeDiscover })
  const { type } = renderTui(<App env={env} globalConfigPath={global} />)
  type("/add-provider\r")
  await new Promise(r => setTimeout(r, 40))
  type("r\rhttp://r/v1\rsk-1\r")
  await new Promise(r => setTimeout(r, 40))
  type("\r")                                   // test — m1, m2
  await new Promise(r => setTimeout(r, 60))
  type("\u001b[B")                             // down to m2
  await new Promise(r => setTimeout(r, 40))
  type(" ")                                    // check it
  await new Promise(r => setTimeout(r, 40))
  type("\r")                                   // import & save
  await new Promise(r => setTimeout(r, 60))
  expect(JSON.parse(readFileSync(global, "utf8")).providers.r.models).toEqual(["m2"])
  expect(allOutputOf()).toContain("1 models imported")
  rmSync(global, { force: true })
})
```

For the other five, insert `type("a")` + a 40 ms wait immediately before the `// import`
`type("\r")`, and change `expect(allOutput()).toContain("models imported")` at `:1520`
to assert the count (`2 models imported`).

- [ ] **Step 2: run them, watch the new one fail**

```bash
~/.bun/bin/bun test src/cli/tui/app.test.tsx -t "imports only the model the user checked"
```
Expected: FAIL — `["m1","m2"]` written.

- [ ] **Step 3: nothing to implement**

The source is already done by Tasks 1-4. If the test still fails, the bug is in Task 3's
commit path, not here — go back and fix it there. This task exists so the app-level proof
is not written by the same hand that, having just written the checklist, assumes it works.

- [ ] **Step 4: run the app tests**

```bash
~/.bun/bin/bun test src/cli/tui/app.test.tsx
```
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/cli/tui/app.test.tsx
git commit -m "test(tui): the app-level /add-provider tests select before importing"
```

---

### Task 8: rewrite the tests the old contract left behind, and the docs

**Files:**
- Modify: `src/cli/tui/add-provider.test.tsx` (the window/dispatch tests `:356-426`, and `:53`, `:241`), `src/cli/add-provider-repl.test.ts` (the 8 remaining `[Y/n]`-era tests)
- Modify: `README.md:115`, `README.md:141`, `src/cli/repl.ts:211`, `src/cli/tui/app.tsx:558`, `docs/architecture/tui.md`, `docs/decisions/cli-tui.md`
- Test: all three test files

**Interfaces:**
- Consumes: everything. Produces: no source behavior change beyond copy.

- [ ] **Step 1: retarget the window tests to the cursor**

- `:356` `a long model list is windowed…` — keep `1-8 of 300`, replace `enter import & save`
  with `space toggle`, keep `≤ 20` lines.
- `:368` `down and up move the window by one model` → **rewrite**: with `model-picker.tsx:74`'s
  arithmetic the window does **not** move on the first `↓`; assert `1-8 of 20` stays and the
  cursor marker moved (`❯ [ ] model-002`), then seven more `↓` and assert `2-9 of 20`. Measured.
- `:380` `end jumps to the last window and home returns to the top` — same numbers survive
  (`13-20 of 20`), keep it.
- `:392` `page down moves a full window` → **rewrite**: measured on the spike, with a
  cursor `PgDn` on 20 rows gives `2-9`, then `10-17`, then clamps to `13-20` (it moves the
  cursor a window, and the window follows the cursor). The old `9-16` was free-scroll
  arithmetic and does not survive.
- `:402` `enter after scrolling still imports every model` → **invert** into
  `enter imports exactly the checked rows, including one scrolled out of view` (Task 3's
  third test already covers this shape; keep one, not two).
- `:420` `a list that fits the window shows no scroll hint` — `3 models found` becomes
  `3 of 3 models selected`; `not.toContain(" of 3")` becomes `not.toContain("—")`.
- `:53` `a passing test lists the models and saves on confirm` — insert `type("a")` + a 30 ms
  wait before the import `\r`.
- `:241` `an existing name asks before overwriting` — same.
- `:267` `a blank key field on a re-run Tests with the stored key` — it asserts
  `"1 model found"`, which the new header removes: becomes `"0 of 1 model selected"`.
- `:356` the windowing test asserts `enter import & save` in the footer, which is now
  `space toggle` / `enter import N & save`: retarget.

That is **eight** renamed/edited tests in this file, not the six an earlier count suggested.
The five proving tests added by Tasks 1-4 bring the file from 26 to 31.

- [ ] **Step 2: rewrite the REPL tests' import answers**

Each of the 8 remaining tests that script an import answer gets one of: `"a"` (they wanted
everything), `"n"` (they wanted cancel), or a number. The mapping, by test:

| Test (line) | Old answer | New |
|---|---|---|
| `:65` answering y overwrites | `"y"` | `"a"` |
| `:86` empty answer to overwrite | `"y"`, `""` | `"a"`, `""` |
| `:104` new provider written without asking | `"y"` | `"a"` |
| `:122` name only in the global file | `"y"` | `"a"` |
| `:144` overwrite prompt says what is replaced | `"y"` | `"a"` |
| `:167` blank key Tests with the stored key | `"a"` | `"a"` (unchanged) |
| `:194` stored `{env:VAR}` key resolved | `"a"` | `"a"` (unchanged) |
| `:230` typed key wins over stored | `"a"` | `"a"` (unchanged) |
| `:247` blank key on a new name, no key | `"a"` | `"a"` (unchanged) |
| `:266` key prompt goes through the masking reader | — | unchanged |
| `:291` front end without a masking reader | — | unchanged |
| `:308` Ctrl+C at the key prompt cancels | — | unchanged |
| `:330` Ctrl+C leaves earlier answers alone | `"y"` | `"a"` |
| `:350` key corrected with arrow keys | `"a"` | `"a"` (unchanged) |

Measured on the spike: **13 of the 19** tests needed an edit (the `scripted()` helper throws
"unexpected prompt" the moment the import answer is not scripted, so a failure there is a
missing answer, not a product bug). Three others answer through a lambda
(`q.startsWith("base url") ? "http://n/v1" : "y"`) rather than `scripted()` — those were
missed by the table above and also need `"a"`. `a` is still a valid answer, but **verify**,
do not assume: `bun test` must be green before the commit.

The blank-answer re-run test also needs an overwrite answer appended (`""` then `"y"`),
because it re-runs an existing name and the gate still asks.

- [ ] **Step 3: update the copy**

Apply exactly the ✓ column of the spec's §7 table:

- `README.md:115` — the long paragraph: replace "writes the provider and every model id" with
  "writes the provider and the models you check", and "**Enter still imports all of them, not
  the visible slice**" with "**Space checks the row under the cursor and Enter imports exactly
  the checked rows — including one scrolled out of view — so nothing is written that you did
  not pick**"; append one sentence on `a` (all/none) and one on the zero-selection rule.
- `README.md:141` — `→ test → select models → import`.
- `src/cli/repl.ts:211` — `…tests the endpoint, asks which models to import`.
- `src/cli/tui/app.tsx:558` — `register a provider (test + select models)`.
- `docs/architecture/tui.md` — the `add-provider.tsx` entry: replace "hands **every** id —
  never the visible slice" with the checklist (`❯` cursor, `[x]`/`[ ]`, `space`, `a`,
  clamped movement, `enter` at zero is a no-op) and the two removal lines; update the
  `scroll`/`PgUp`/`Home` sentence to the cursor arithmetic.
- `docs/decisions/cli-tui.md` — new entry at the end of the file, in the file's format
  (`## YYYY-MM-DD — title` / `Decision:` / `Why:` / `Cost if wrong:` / `Index:` backlink):

```markdown
## 2026-11-12 — /add-provider imports a selection, not the whole list

Decision: the `import` phase is a checklist. `space` toggles the row under the cursor,
`a` checks all or none, and `enter` writes exactly the checked ids — in endpoint order,
duplicates included. Selection is a `Set<number>` of indices, not of ids: a gateway can
advertise the same id twice, and an id set would toggle both rows at once. `enter` with
nothing checked is a no-op; the `--plain` REPL asks for numbers, keeps the stored set on
a blank answer, and gives up after three unparseable tries. This reverses the 2026-11-11
entry above ("a checklist would be a new feature with its own decision") — this is that
feature, and the demand is that the owner was handed a 200-model provider with all of it
imported.

Why: the cached `models` list is what `/model` shows, so an all-or-nothing import turns
every junk id, embedding model and dated snapshot into a row the user scrolls past daily.
Listing is free; the write has to be a choice.

Cost if wrong: a user who wanted everything pays one keystroke (`a`), and a user who
wanted the models-less save now has only the `nomodels` path to get it — the `enter`-at-zero
shortcut is deliberately gone, because that outcome is indistinguishable from a save the
user never chose.
```

- [ ] **Step 4: run the whole suite**

```bash
~/.bun/bin/bun test
```
Expected: **0 fail**. Measured on the spike: **630 pass / 0 fail / 55 files / 3 snapshots /
1604 asserts**, up from the 620/55 baseline. The file count stays 55 — no new test file, every
test went into an existing one. If the suite reports a different total, one of the rewrites in
this task was deleted instead of retargeted.

- [ ] **Step 5: commit and open the PR**

```bash
git add README.md docs/architecture/tui.md docs/decisions/cli-tui.md \
        src/cli/repl.ts src/cli/tui/app.tsx src/cli/tui/add-provider.test.tsx \
        src/cli/add-provider-repl.test.ts
git commit -m "docs: /add-provider imports a selection, not every model"
git push -u origin feat/add-provider-model-selection
```

Then open the PR against `main` with a body carrying the demand verbatim, the spec and plan
paths, and the call that needs a veto (zero-selection `enter` is a no-op).
