# add-provider model-list scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap the `import` phase of `/add-provider` at an 8-row window with keyboard scrolling, so a provider announcing hundreds of models no longer renders a frame taller than the terminal.

**Architecture:** One component, one phase. `src/cli/tui/add-provider.tsx` gains `MAX_VISIBLE = 8`, a `scroll` counter (plus a `scrollRef` mirror, the file's existing ink-batching discipline) and six key bindings that exist only while `phase === "import"`. The list is sliced at render; `enter` still hands **every** model to `onSaved`. Same shape as the five sibling pickers in the directory, none of which this touches.

**Tech Stack:** TypeScript, Bun, `bun:test`, ink v8 + react, `renderTui` from `src/cli/tui/harness.tsx`.

**Spec:** `docs/superpowers/specs/2026-11-11-add-provider-model-scroll-design.md`

## Global Constraints

- **TDD is law.** Test file next to the module (`add-provider.test.tsx` — it already exists, 338 lines). Watch the new tests FAIL before writing the component change.
- **Branch:** this work lands on **`feat/add-provider`**, because `src/cli/tui/add-provider.tsx` does not exist on `origin/main` (verified: `git show origin/main:src/cli/tui/add-provider.tsx` → absent). Worktree: `/home/luiz/projects/lugent/.worktrees/add-provider` (HEAD `f78de89`). Do not base this on `main`.
- **`bun` is installed at `~/.bun/bin/bun` (1.4.4) but is NOT on the non-interactive shell's PATH.** Invoke by absolute path or `export PATH="$HOME/.bun/bin:$PATH"`. Never report "bun is not installed".
- Baseline measured on this worktree before the change: `bun test` → **605 pass / 0 fail / 55 files**. A run that ends with fewer than 605 passes means tests were lost, not that the change is clean.
- `src/core/` is untouched (its zero-runtime-dependency rule does not apply to `src/cli/tui/`, which may use ink/react — decision-logged).
- Conventional commits only (`fix:`, `docs:`). Docs and code comments in English.
- **Never write to `docs/specs/` or `docs/plans/`** (gitignored, history was rewritten once to keep them off `origin`). Spec and plan live in `docs/superpowers/`.
- PR is automatic once green + docs updated: push and open/update against `main`. Here that means pushing to `feat/add-provider` and commenting on **PR #33** — no new PR.
- **Do not truncate or wrap model ids.** An over-wide id wraps in ink exactly as it does in `ModelPicker`; parity beats an invented ellipsis.

## Review Focus

- **Enter after scrolling must import ALL models, not the visible window.** A user who presses `End`, sees `model-300`, and hits enter expects the whole list in the config. The scroll state is view-only; `pendingModelsRef.current` is never sliced.
- **A short list (≤ 8) must render exactly as it does today**, with no scroll hint and no indicator. Two existing tests assert the current copy (`1 model found`, `a passing test lists the models and saves on confirm`).
- **`esc` still cancels from `import`,** including after scrolling — the escape branch runs before any phase logic.
- **A duplicate model id from the endpoint must not break the window.** `key={m}` collides when the endpoint advertises the same id twice; the window key must include the absolute index.
- **A models-less endpoint never reaches this phase,** so `models.length === 0` must not produce a negative window or a `-8 of 0` indicator (`nomodels` owns that path).

---

### Task 1: Window the `import` list and scroll it

**Files:**
- Modify: `src/cli/tui/add-provider.tsx` (constants near line 14; state near lines 44-62; `runTest` at 99-118; the action-phase key block at 166-182; the `import` render at 230-235; the footer at 245-251)
- Test: `src/cli/tui/add-provider.test.tsx` (append; existing helpers `base` and `wait` at lines 1-7)
- Docs (same commit): `docs/architecture/tui.md:13` (the `add-provider.tsx` sentence saying it "lists every id"), `README.md:115` (the `/add-provider` sentence), `docs/decisions/cli-tui.md` (new dated entry, inserted **before** the trailing `---` / `Index:` block)

**Interfaces:**
- Consumes: nothing from other tasks — this is the only task. It uses `renderTui(tree, { rows })` from `./harness` (default 30 rows, 100 columns) and the `AddProvider` props already in the file (`discover`, `onSaved`, `existing`, `storedEntry`, `onClose`).
- Produces: no exported symbol. The contract is visual + behavioral: the `import` phase occupies a constant number of rows and responds to `↑` `↓` `pageUp` `pageDown` `home` `end`, while `enter` keeps handing the full list to `onSaved(name, { baseUrl, apiKey?, models })`.

- [ ] **Step 1: Write the failing tests**

Append to `src/cli/tui/add-provider.test.tsx`. Twenty models is enough to exceed the window; `many()` keeps the ids distinguishable at both ends.

```tsx
const many = (n: number) => Array.from({ length: n }, (_, i) => `model-${String(i + 1).padStart(3, "0")}`)

/** Drive the form to the import phase with `n` advertised models. */
async function toImport(n: number, saved: any[] = []) {
  const list = many(n)
  const ui = renderTui(
    <AddProvider {...base} onSaved={(name, cfg) => saved.push([name, cfg])}
      discover={() => Promise.resolve({ ok: true, models: list })} />,
  )
  ui.type("r\rhttp://r/v1\rsk-1\r")
  await wait(30)
  ui.type("\r")                                  // Test
  await wait(40)
  return ui
}

test("a long model list is windowed so the header and footer stay on screen", async () => {
  // Measured before the fix: 300 models rendered a 69-row frame on a 30-row
  // terminal, pushing the form's own header and footer off the screen.
  const { lastFrame } = await toImport(300)
  const frame = lastFrame()
  expect(frame).toContain("model-001")
  expect(frame).not.toContain("model-300")
  expect(frame).toContain("1-8 of 300")
  expect(frame).toContain("enter import & save")     // the footer still exists
  expect(frame.split("\n").length).toBeLessThanOrEqual(20)  // and the frame is bounded
})

test("down and up move the window by one model", async () => {
  const { type, lastFrame } = await toImport(20)
  type("\u001b[B")                                // down
  await wait(30)
  expect(lastFrame()).toContain("model-002")
  expect(lastFrame()).not.toContain("model-001 ")
  expect(lastFrame()).toContain("2-9 of 20")
  type("\u001b[A")                                // up
  await wait(30)
  expect(lastFrame()).toContain("model-001")
})

test("end jumps to the last window and home returns to the top", async () => {
  const { type, lastFrame } = await toImport(20)
  type("\u001b[F")                                // end
  await wait(30)
  expect(lastFrame()).toContain("model-020")
  expect(lastFrame()).toContain("13-20 of 20")
  type("\u001b[H")                                // home
  await wait(30)
  expect(lastFrame()).toContain("model-001")
  expect(lastFrame()).toContain("1-8 of 20")
})

test("page down moves a full window, clamped at the end", async () => {
  const { type, lastFrame } = await toImport(20)
  type("\u001b[6~")                               // pgdn
  await wait(30)
  expect(lastFrame()).toContain("9-16 of 20")
  type("\u001b[6~")                               // pgdn again — clamps, no overshoot
  await wait(30)
  expect(lastFrame()).toContain("13-20 of 20")
})

test("enter after scrolling still imports every model, not just the window", async () => {
  // Two asserts on purpose: the window assert makes this RED before the feature
  // exists, and the import assert pins the all-or-nothing contract against a
  // future slice of `pendingModelsRef`. Asserting only that `model-020` is
  // visible would pass on the unfixed code, where the un-windowed list renders
  // every id — it must be `model-001` disappearing that proves the window moved.
  const saved: any[] = []
  const { type, lastFrame } = await toImport(20, saved)
  type("\u001b[F")                                // end
  await wait(30)
  expect(lastFrame()).toContain("model-020")
  expect(lastFrame()).not.toContain("model-001")
  type("\r")                                      // import & save
  await wait(30)
  expect(saved.length).toBe(1)
  expect(saved[0][1].models).toEqual(many(20))
})

test("a list that fits the window shows no scroll hint", async () => {
  const { lastFrame } = await toImport(3)
  const frame = lastFrame()
  expect(frame).toContain("3 models found")
  expect(frame).not.toContain(" of 3")
  expect(frame).not.toContain("scroll")
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd <worktree> && ~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx`
Expected: **5 of the 6 new tests FAIL** (windowed render, `↓`/`↑`, `end`/`home`, `pgdn`, enter-after-scroll) and the sixth — `a list that fits the window shows no scroll hint` — **PASSES**: it is a regression pin on today's short-list copy, not a feature test. The file's pre-existing tests keep passing. Measured on this worktree with the implementation reverted:

```
21 pass / 5 fail   (26 total)
```


- [ ] **Step 3: Implement the window in `src/cli/tui/add-provider.tsx`**

Next to `const MASK = "•"` (line 14): `const MAX_VISIBLE = 8` — the same value the five sibling pickers use.

State, next to the other refs (after `keyRef`, line 61):

```tsx
// Which slice of a long model list is on screen. View-only: the import always
// writes every model, so this never feeds `pendingModelsRef`.
const [scroll, setScroll] = useState(0)
const scrollRef = useRef(0)
const setScrollBoth = (n: number) => { scrollRef.current = n; setScroll(n) }
```

In `runTest`, right where the models arrive (line 115-117) — a retest that advertises a different list must not keep the old offset:

```tsx
    setModels(r.models)
    setScrollBoth(0)
    pendingModelsRef.current = r.models
```

In the action-phase key block, inside `if (phaseRef.current !== "name" && …)`, **before** the `if (!k.return) return` at line 178 — the window keys live only in `import`, and `esc` (line 159) already returned by then:

```tsx
      if (phaseRef.current === "import") {
        const step = (d: number) => setScrollBoth(Math.max(0, scrollRef.current + d))
        if (k.upArrow) { step(-1); return }
        if (k.downArrow) { step(1); return }
        if (k.pageUp || (k.shift && k.upArrow)) { step(-MAX_VISIBLE); return }
        if (k.pageDown || (k.shift && k.downArrow)) { step(MAX_VISIBLE); return }
        if (k.home) { setScrollBoth(0); return }
        // `end` may overshoot; the render clamps to the last full window.
        if (k.end) { setScrollBoth(models.length); return }
      }
```

Render, replacing the `import` block at lines 230-235. `start` clamps on every render, so an overshoot from `end` — or from a shorter list after a retest — can never produce an empty window:

```tsx
  const fit = models.length <= MAX_VISIBLE
  const start = Math.min(scroll, Math.max(0, models.length - MAX_VISIBLE))
  const view = models.slice(start, start + MAX_VISIBLE)
```

```tsx
      {phase === "import" && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {models.length} model{models.length === 1 ? "" : "s"} found
            {fit ? "" : ` — ${start + 1}-${start + view.length} of ${models.length}`}
            {" — import all of them?"}
          </Text>
          {view.map((m, i) => <Text key={`${start + i}-${m}`} dimColor>  {start + i + 1}. {m}</Text>)}
        </Box>
      )}
```

Footer, replacing the `import` arm at line 248 — the hint appears only when there is something to scroll:

```tsx
            : phase === "import" ? (fit ? "enter import & save · esc cancel" : "↑/↓ scroll · pgup/pgdn page · enter import & save · esc cancel")
```

Both `↑`/`↓` and `PgUp`/`PgDn` are `useInput`-detected by ink core (`node_modules/ink/build/parse-keypress.js` maps `[A`/`[B`/`[5~`/`[6~`/`[H`/`[F`), and `app.tsx:322-330` released the keys to the form already (`if (overlayRef.current || ask) return`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/.bun/bin/bun test src/cli/tui/add-provider.test.tsx`
Expected: PASS — **26 pass / 0 fail** (20 pre-existing + 6 new). Verified.

Then the whole suite: `~/.bun/bin/bun test`
Expected: **611 pass / 0 fail / 55 files** (605 baseline + 6). Verified on a clean worktree at `f78de89` with this exact patch. Prompt snapshot zero diff (this change never touches `src/core/prompt.ts`).

- [ ] **Step 5: Prove the tests are sensitive**

Two reverts, one at a time, each followed by a re-run of the file and a restore:

1. `MAX_VISIBLE = 8` → `MAX_VISIBLE = 1_000` (window effectively disabled). Expected: **5 fail / 21 pass** — the same 5 as Step 2. Verified.
2. Keep the window state but append the rest of the list back into the render (`models.slice(start + MAX_VISIBLE).map(...)`). Expected: **1 fail** (the frame-bound test only) — this is what proves the row cap is asserted, not just the indicator. Verified.

A window test that survives `MAX_VISIBLE = 1000` proves nothing; restore `8` and confirm **26 pass / 0 fail** before moving on.


- [ ] **Step 6: Update the docs**

- `docs/architecture/tui.md:13` — in the `add-provider.tsx` sentence, replace "which lists every id and hands `{ baseUrl, apiKey, models }`" with a clause that says the list renders in an 8-row window (`↑/↓` one, `PgUp`/`PgDn` a window, `Home`/`End` the ends, with a `start-end of total` indicator) while the import stays all-or-nothing.
- `README.md:115` — in the `/add-provider` sentence, after "writes the provider and every model id to the global config", add that a long model list is shown in a scrolling window.
- `docs/decisions/cli-tui.md` — new entry `## 2026-11-11 — /add-provider's import lists models in an 8-row window`, with Context / Decision / Why / `Cost if wrong`, inserted **before** the trailing `---` + `Index:` backlink (an earlier commit left the backlink mid-file; do not repeat that). Content: the measurement (60 models → 69-row frame on 30 rows, reproduced with `renderTui`), why the window is fixed at 8 rather than derived from `stdout.rows` (the sibling pickers' `MAX_VISIBLE`, and the form does not receive `rows`), why `↑`/`↓` move the window instead of a `❯` cursor (nothing is being selected — the import is all-or-nothing), and the cost if wrong (a 30-row terminal shows 8 rows of models where it could show ~20; `ChildViewer`'s `transcriptWindow` sizing remains the only row-derived list in the TUI).
- Nothing else: `docs/README.md` needs no new row (no new file), and `docs/specs/` / `docs/plans/` stay untouched.

- [ ] **Step 7: Commit**

```bash
git add src/cli/tui/add-provider.tsx src/cli/tui/add-provider.test.tsx docs/architecture/tui.md docs/decisions/cli-tui.md README.md
git commit -m "fix(add-provider): window the model import list so a long list scrolls"
```

Then push to `feat/add-provider` and post a short comment on **PR #33** (the PR that introduces this form) — no new PR, because the file does not exist on `main`.
