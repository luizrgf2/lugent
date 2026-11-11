# add-provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app form that registers an OpenAI-compatible provider — test the endpoint, import its `/models` list, and persist everything to the global config.

**Architecture:** One pure persist function in `src/core/config.ts` (sibling of `savePermissionMode`), one HTTP discovery helper in `src/core/provider.ts`, one ink form in `src/cli/tui/`, and a line-oriented equivalent in `src/cli/repl.ts`. The form never writes the file itself; it builds a candidate config, hands it to `discoverModels`, then to `saveProvider`.

**Tech Stack:** TypeScript + Bun (`bun test`), React + Ink v8 for the TUI, `node:fs` only in core. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-add-provider-design.md`

## Global Constraints

- `src/core/` has **zero runtime dependencies** — `node:fs`, `node:path`, `node:os` only.
- Every config test passes an **explicit `globalPath`**; no test may read or write the real `~/.config/lugent/`.
- `src/cli/repl.ts` and `src/cli/ui.ts` stay **ANSI-only**; ink only inside `src/cli/tui/`.
- `src/core/prompt.ts` and its golden snapshot must not change. `bun test` must stay at **460 pass / 0 fail** plus the new tests.
- Baseline to preserve: `460 pass, 0 fail` across 50 files.
- The written file is `JSON.stringify(raw, null, 2) + "\n"`, other keys preserved.
- Stored key is **exactly what the user typed** (`{env:VAR}` included); `subEnv()` resolves at load and at Test.
- `baseUrl` trailing slashes are stripped **before writing** (spec decision 4).
- Conventional commits; docs in English; docs ship in the same commit as the code.
- Never write a project-level `lugent.json` (AGENTS.md).

## Review Focus

Inputs/conditions the spec implies but no single task's happy path covers. Each gets a test in the task that owns the code:

1. `baseUrl` with a trailing slash — must not produce `//models` and must not be saved with the slash.
2. Provider name that is empty, contains whitespace, or contains `/` — must be rejected before any write.
3. `apiKey: "{env:VAR}"` with `VAR` unset — must report a missing variable, not send an unauthenticated request and blame the server.
4. `200` with `{"data":[]}` or a non-JSON (HTML) body — must not unlock the import as if it succeeded.
5. An existing global config holding `permissionMode`/`mcp`/`defaultProvider` — adding a provider must leave all of them intact; an unparseable file is replaced, as `savePermissionMode` already does.

---

### Task 1: `models` survives the loader, and `saveProvider` writes the global file

**Files:**
- Modify: `src/core/config.ts:5` (`ProviderConfig`), `src/core/config.ts:30-34` (loader loop)
- Test: `src/core/config.test.ts`

**Interfaces:**
- Consumes: nothing (extends existing `subEnv`, `globalConfigPath`).
- Produces:
  - `interface ProviderConfig { baseUrl: string; apiKey?: string; models?: string[] }`
  - `saveProvider(name: string, cfg: { baseUrl: string; apiKey?: string; models?: string[] }, path?: string): { ok: boolean; error?: string }`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/config.test.ts`, importing `saveProvider` and `statSync`:

```ts
test("loader keeps a provider's cached models list", () => {
  const dir = `/tmp/opencode/cfg-models-${Date.now()}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/lugent.json`, JSON.stringify({
    providers: { r: { baseUrl: "http://r/v1", models: ["a", "b", "", 7] } },
    defaultProvider: "r", defaultModel: "a",
  }))
  expect(loadConfig(dir).providers.r.models).toEqual(["a", "b"])
  rmSync(dir, { recursive: true, force: true })
})

test("loader leaves an absent or non-array models alone", () => {
  const dir = `/tmp/opencode/cfg-nomodels-${Date.now()}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/lugent.json`, JSON.stringify({
    providers: { r: { baseUrl: "http://r/v1", models: "nope" } },
    defaultProvider: "r", defaultModel: "a",
  }))
  expect(loadConfig(dir).providers.r.models).toBeUndefined()
  rmSync(dir, { recursive: true, force: true })
})

test("saveProvider writes the global file and keeps every other key", () => {
  const p = `/tmp/opencode/save-prov-${Date.now()}.json`
  writeFileSync(p, JSON.stringify({ permissionMode: "yolo", defaultProvider: "x", mcp: { a: { type: "remote", url: "https://a/mcp" } } }))
  const r = saveProvider("router", { baseUrl: "http://r/v1", apiKey: "sk-1", models: ["m1"] }, p)
  expect(r.ok).toBe(true)
  const raw = JSON.parse(readFileSync(p, "utf8"))
  expect(raw.providers.router).toEqual({ baseUrl: "http://r/v1", apiKey: "sk-1", models: ["m1"] })
  expect(raw.permissionMode).toBe("yolo")
  expect(raw.defaultProvider).toBe("x")
  expect(raw.mcp.a.url).toBe("https://a/mcp")
  rmSync(p, { force: true })
})

test("saveProvider strips trailing slashes from baseUrl", () => {
  const p = `/tmp/opencode/save-slash-${Date.now()}.json`
  expect(saveProvider("r", { baseUrl: "http://r/v1///" }, p).ok).toBe(true)
  expect(JSON.parse(readFileSync(p, "utf8")).providers.r.baseUrl).toBe("http://r/v1")
  rmSync(p, { force: true })
})

test("saveProvider keeps an existing apiKey when the new one is empty", () => {
  const p = `/tmp/opencode/save-keep-${Date.now()}.json`
  saveProvider("r", { baseUrl: "http://r/v1", apiKey: "old" }, p)
  saveProvider("r", { baseUrl: "http://r/v1", apiKey: "", models: ["x"] }, p)
  const raw = JSON.parse(readFileSync(p, "utf8"))
  expect(raw.providers.r.apiKey).toBe("old")
  expect(raw.providers.r.models).toEqual(["x"])
  rmSync(p, { force: true })
})

test("saveProvider mode is 0600 when an inline key is written", () => {
  const p = `/tmp/opencode/save-mode-${Date.now()}.json`
  saveProvider("r", { baseUrl: "http://r/v1", apiKey: "sk-secret" }, p)
  expect(statSync(p).mode & 0o777).toBe(0o600)
  rmSync(p, { force: true })
})

test("saveProvider replaces an unparseable file and reports a failed write", () => {
  const p = `/tmp/opencode/save-corrupt-${Date.now()}.json`
  writeFileSync(p, "not json")
  expect(saveProvider("r", { baseUrl: "http://r/v1" }, p).ok).toBe(true)
  expect(JSON.parse(readFileSync(p, "utf8")).providers.r.baseUrl).toBe("http://r/v1")
  const bad = saveProvider("r", { baseUrl: "http://r/v1" }, "/proc/nope/config.json")
  expect(bad.ok).toBe(false)
  expect(bad.error).toBeTruthy()
  rmSync(p, { force: true })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/core/config.test.ts`
Expected: FAIL — `saveProvider is not a function` (or an import error), and the models assertions `undefined`.

- [ ] **Step 3: Implement**

In `src/core/config.ts`, extend the interface (line 5) to `{ baseUrl: string; apiKey?: string; models?: string[] }`, and in the loader loop keep the list only when it is an array of non-empty strings — no `subEnv` on model ids, they are literal:

```ts
const models = Array.isArray(pc.models) ? pc.models.filter((m): m is string => typeof m === "string" && m !== "") : undefined
providers[name] = { baseUrl: pc.baseUrl, apiKey: pc.apiKey ? subEnv(pc.apiKey) : undefined, ...(models ? { models } : {}) }
```

Then add `saveProvider` next to `savePermissionMode`, same read-modify-write shape: parse the file with an empty-object fallback, strip trailing slashes with `.replace(/\/+$/, "")`, merge into `raw.providers[name]`, keeping the previously stored `apiKey` when the incoming one is `""`, and only setting `models` when the argument is present. Write with `mkdirSync(dirname(path), { recursive: true })`; when an `apiKey` ends up non-empty, write with `{ mode: 0o600 }` and `chmodSync(path, 0o600)` after (a pre-existing looser file keeps its bits otherwise — see `src/core/mcp/oauth/store.ts:36-37`). Return `{ ok: false, error }` in the `catch`, never throw.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test src/core/config.test.ts`
Expected: PASS, all 7 new tests plus the existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts src/core/config.test.ts
git commit -m "feat(config): persist a provider and keep its cached model list"
```

---

### Task 2: `discoverModels` — the Test action as a pure function

**Files:**
- Modify: `src/core/provider.ts` (append after the `Provider` class)
- Test: `src/core/provider.test.ts`

**Interfaces:**
- Consumes: `ProviderConfig` from Task 1 (the `models` field is irrelevant here).
- Produces: `discoverModels(cfg: ProviderConfig, opts?: { fetchFn?: typeof fetch; timeoutMs?: number }): Promise<{ ok: boolean; models: string[]; error?: string }>`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/provider.test.ts`:

```ts
test("discoverModels returns ids on 200 and resolves the key", async () => {
  let seen = ""
  const r = await discoverModels({ baseUrl: "http://r/v1", apiKey: "sk-1" }, {
    fetchFn: (async (url: string, init: any) => { seen = `${url} ${init.headers.authorization}`; return new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), { status: 200 }) }) as any,
  })
  expect(r.ok).toBe(true)
  expect(r.models).toEqual(["a", "b"])
  expect(seen).toBe("http://r/v1/models Bearer sk-1")
})

test("discoverModels does not double the slash on a trailing-slash baseUrl", async () => {
  let seen = ""
  await discoverModels({ baseUrl: "http://r/v1/" }, {
    fetchFn: (async (url: string) => { seen = url; return new Response(JSON.stringify({ data: [] }), { status: 200 }) }) as any,
  })
  expect(seen).toBe("http://r/v1/models")
})

test("discoverModels reports a non-200 without throwing", async () => {
  const r = await discoverModels({ baseUrl: "http://r/v1" }, { fetchFn: (async () => new Response("nope", { status: 401 })) as any })
  expect(r.ok).toBe(false)
  expect(r.error).toContain("401")
})

test("discoverModels rejects a 200 with no models, and one with an HTML body", async () => {
  const empty = await discoverModels({ baseUrl: "http://r/v1" }, {
    fetchFn: (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as any,
  })
  expect(empty.ok).toBe(false)
  expect(empty.error).toContain("no models")
  const html = await discoverModels({ baseUrl: "http://r/v1" }, {
    fetchFn: (async () => new Response("<html>hi</html>", { status: 200 })) as any,
  })
  expect(html.ok).toBe(false)
})

test("discoverModels reports an unresolved {env:VAR} as a missing variable", async () => {
  const r = await discoverModels({ baseUrl: "http://r/v1", apiKey: "{env:LUGENT_UNSET_KEY}" }, { fetchFn: (async () => new Response("{}")) as any })
  expect(r.ok).toBe(false)
  expect(r.error).toContain("LUGENT_UNSET_KEY")
})

test("discoverModels gives up on a host that never answers", async () => {
  const r = await discoverModels({ baseUrl: "http://dead/v1" }, {
    timeoutMs: 50,
    fetchFn: ((_u: string, init: any) => new Promise((_res, rej) => {
      init.signal.addEventListener("abort", () => rej(new Error("aborted")))
    })) as any,
  })
  expect(r.ok).toBe(false)
  expect(r.error).toBeTruthy()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/core/provider.test.ts`
Expected: FAIL — `discoverModels` is not exported.

- [ ] **Step 3: Implement**

Append to `src/core/provider.ts`. Import `subEnv` from `./config`. Behavior: strip trailing slashes from `cfg.baseUrl`; if the key matches `^\{(env:)?`-style substitution and `subEnv` yields `""` while the raw string still contains `{env:`, return `{ ok: false, models: [], error: "environment variable <NAME> is not set" }` naming the variable — parse the name out of the `{env:NAME}` match. Call `` `${base}/models` `` with the same `authorization` header rule as `Provider.headers()` and `AbortSignal.timeout(opts.timeoutMs ?? 10_000)`. On a non-`ok` response return `{ ok: false, models: [], error: `HTTP ${status}` }`. Parse JSON in a `try`; on a throw return `{ ok: false, models: [], error: "response is not JSON" }`. Map `data[].id` to non-empty strings; if the result is empty return `{ ok: false, models: [], error: "endpoint answered but advertised no models" }`; otherwise `{ ok: true, models }`. Never throw.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test src/core/provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/provider.ts src/core/provider.test.ts
git commit -m "feat(provider): discover an endpoint's models with a bounded, non-throwing call"
```

---

### Task 3: The form

**Files:**
- Create: `src/cli/tui/add-provider.tsx`
- Test: `src/cli/tui/add-provider.test.tsx`

**Interfaces:**
- Consumes: `discoverModels` (Task 2), `saveProvider` (Task 1).
- Produces: `<AddProvider existing: string[]; shadowed?: boolean; onSaved(name: string, cfg: { baseUrl: string; apiKey?: string; models?: string[] }): void; onClose(): void />`

- [ ] **Step 1: Write the failing tests**

Create `src/cli/tui/add-provider.test.tsx` using `renderTui` from `./harness` and fake timers via short sleeps, mirroring `model-picker.test.tsx`:

```ts
const base = { existing: [], onSaved: () => {}, onClose: () => {} }

test("rejects a blank name and a name with whitespace or a slash", async () => {
  const { type, lastFrame } = renderTui(<AddProvider {...base} />)
  type("\r")                                  // submit empty name
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("name is required")
  type("my router\r")
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).toContain("name cannot contain spaces")
})

test("import stays locked until a test returns models", async () => {
  const { type, lastFrame } = renderTui(<AddProvider {...base} discover={() => Promise.resolve({ ok: false, models: [], error: "HTTP 401" })} />)
  type("r\rmy router\rhttp://r/v1\rsk-1\r")
  await new Promise(r => setTimeout(r, 30))
  type("\r")                                  // Test
  await new Promise(r => setTimeout(r, 40))
  expect(lastFrame()).toContain("HTTP 401")
  expect(lastFrame()).not.toContain("import")
})

test("a passing test lists the models and saves on confirm", async () => {
  const saved: any[] = []
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} onSaved={(n, c) => saved.push([n, c])} discover={() => Promise.resolve({ ok: true, models: ["a", "b"] })} />
  )
  type("r\rmy router\rhttp://r/v1\rsk-1\r")
  await new Promise(r => setTimeout(r, 30))
  type("\r")                                  // Test
  await new Promise(r => setTimeout(r, 40))
  expect(lastFrame()).toContain("a")
  expect(lastFrame()).toContain("b")
  type("\r")                                  // import & save
  await new Promise(r => setTimeout(r, 30))
  expect(saved[0][0]).toBe("my router")
  expect(saved[0][1].models).toEqual(["a", "b"])
})

test("the key is never echoed in full", async () => {
  const { type, lastFrame } = renderTui(<AddProvider {...base} />)
  type("r\rsk-supersecret\r")
  await new Promise(r => setTimeout(r, 30))
  expect(lastFrame()).not.toContain("sk-supersecret")
})

test("an existing name asks before overwriting", async () => {
  const saved: any[] = []
  const { type, lastFrame } = renderTui(
    <AddProvider existing={["r"]} onSaved={(n, c) => saved.push(n)} discover={() => Promise.resolve({ ok: true, models: ["a"] })} />
  )
  type("r\rmy router\rhttp://r/v1\r\r")
  await new Promise(r => setTimeout(r, 30))
  type("\r")
  await new Promise(r => setTimeout(r, 40))
  expect(lastFrame()).toContain("overwrite")
  expect(saved.length).toBe(0)
})
```

`discover` is an optional prop defaulting to `discoverModels`, so tests never touch the network.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/cli/tui/add-provider.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

One component, one `useInput` handler, refs mirroring state (the ink batching hazard documented in `input.tsx:34-36` and `model-picker.tsx:20`). Phases in order: `name` → `url` → `key` → `test` → `import`. Name validation on submit: empty → `name is required`; `/\s/` → `name cannot contain spaces`; `/` → `name cannot contain /`. URL validation: must start with `http://` or `https://`, else stay on the phase with a message; warn (`missing /v1 — the README expects it`) without blocking. The key field renders masked characters, never the real value. Test calls `p.discover({ baseUrl, apiKey })` with a loading line, keeps `error` visible on failure, and only on `ok` moves to `import` listing every returned model. Enter on `import` calls `p.onSaved(name, { baseUrl, apiKey, models })` and leaves closing to the caller (same contract as `ModelPicker.onPick`). Escape closes via `onClose`. If `p.existing` contains the name, insert a confirm phase whose text names the consequence (`overwrite r? its model list will be replaced; an empty key field keeps the current key`). Render in a round cyan border box like `permission-mode.tsx`.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test src/cli/tui/add-provider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/tui/add-provider.tsx src/cli/tui/add-provider.test.tsx
git commit -m "feat(tui): add-provider form with a test-before-import step"
```

---

### Task 4: Wire `/add-provider` into the TUI, and let `/model` prefer the cached list

**Files:**
- Modify: `src/cli/tui/app.tsx:23-26` (`TuiEnv`), `:69-70` (overlay union), `:114-131` (slash dispatch), `:284-355` (overlay render), `:361-369` (completions)
- Test: `src/cli/tui/app.test.tsx`

**Interfaces:**
- Consumes: `AddProvider` (Task 3), `saveProvider` (Task 1), `discoverModels` (Task 2).
- Produces: the `/add-provider` overlay id; `TuiEnv.discoverModels?`; the live push into `env.config.providers`; `/model`'s cached-list path.

- [ ] **Step 1: Write the failing tests**

Add to `src/cli/tui/app.test.tsx` (it already injects `globalConfigPath`, see `:205`):

```ts
const fakeDiscover = async () => ({ ok: true, models: ["m1", "m2"] })

test("/add-provider saves to the global config and the provider is usable at once", async () => {
  const global = `/tmp/opencode/tui-addprov-${Date.now()}.json`
  const env = fakeEnv({ projectRoot: "/tmp/opencode", discoverModels: fakeDiscover })
  const { type, lastFrame } = renderTui(<App env={env} globalConfigPath={global} />)
  type("/add-provider\r")
  await new Promise(r => setTimeout(r, 40))
  expect(lastFrame()).toContain("add-provider")
  type("r\rmy router\rhttp://r/v1\rsk-1\r")
  await new Promise(r => setTimeout(r, 40))
  type("\r")                                   // test — injected discover lists m1, m2
  await new Promise(r => setTimeout(r, 60))
  type("\r")                                   // import
  await new Promise(r => setTimeout(r, 60))
  expect(JSON.parse(readFileSync(global, "utf8")).providers["my router"].models).toEqual(["m1", "m2"])
  expect(env.config.providers["my router"].baseUrl).toBe("http://r/v1")   // live push, no restart
})

test("/model lists a cached model list without calling the endpoint", async () => {
  const env = fakeEnv({
    config: {
      defaultProvider: "r", defaultModel: "m1",
      providers: { r: { baseUrl: "http://r/v1", models: ["cached-a", "cached-b"] } },
    },
    makeProvider: () => ({ chat: async () => ({}), listModels: async () => { throw new Error("must not be called") } }),
  })
  const { type, lastFrame } = renderTui(<App env={env} />)
  type("/model\r")
  await new Promise(r => setTimeout(r, 40))
  type("\r")                                   // enter the provider level
  await new Promise(r => setTimeout(r, 40))
  expect(lastFrame()).toContain("cached-a")
  expect(lastFrame()).toContain("cached-b")
})

test("/add-provider warns when a project config shadows it", async () => {
  const dir = `/tmp/opencode/tui-shadow-${Date.now()}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/lugent.json`, JSON.stringify({ providers: { p: { baseUrl: "http://p/v1" } } }))
  const global = `${dir}/global.json`
  const env = fakeEnv({ projectRoot: dir, discoverModels: fakeDiscover })
  const { type, lastFrame } = renderTui(<App env={env} globalConfigPath={global} />)
  type("/add-provider\r")
  await new Promise(r => setTimeout(r, 40))
  type("r\rmy router\rhttp://r/v1\rsk-1\r\r\r")
  await new Promise(r => setTimeout(r, 120))
  expect(lastFrame()).toContain("shadowed")
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/cli/tui/app.test.tsx`
Expected: FAIL — `/add-provider` is answered with the "use --plain mode" error; the `/model` test fails because the picker calls `listModels` and throws.

- [ ] **Step 3: Implement**

Add `discoverModels?: typeof discoverModels` to `TuiEnv` (`:23-26`) — the same injection seam `makeProvider` already provides for tests. Add `"add-provider"` to both the `overlay` state and `overlayRef` unions (`:69-70`), and a dispatch branch before the fallback error (`:131`), guarded by `!busy` like its siblings.

Add an `overlay === "add-provider"` arm rendering `<AddProvider existing={Object.keys(env.config.providers)} shadowed={projectShadowsProviders} discover={env.discoverModels ?? discoverModels} onSaved={...} onClose={closeOverlay} />`. In `onSaved`: call `saveProvider(name, cfg, props.globalConfigPath ?? globalConfigPath())`; on `ok`, assign the normalized entry into `env.config.providers[name]` (so `/model` sees it without a restart) and append a `system` item reading `<name> · <n> models imported`, suffixed ` — shadowed by this directory's lugent.json` when the project file declares providers, and `— save failed, session only` on a failed write (the exact failure wording `permission mode` already uses at `:353`). Compute `projectShadowsProviders` by reading `<env.projectRoot>/lugent.json` and checking for a non-empty `providers` object, in a `try` that yields `false` on any error.

Add `{ cmd: "add-provider", desc: "register a provider (test + import models)" }` to the completions array (`:361-369`).

Finally, the `/model` picker must prefer the cache: in `loadModels` (`:289-294`), return `cfg.models` when it is a non-empty array, and only fall back to `new Provider(...).listModels()` otherwise.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test src/cli/tui/app.test.tsx`
Expected: PASS, and the pre-existing 30+ tests in that file still pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/tui/app.tsx src/cli/tui/app.test.tsx
git commit -m "feat(tui): /add-provider — save, push live, warn when shadowed; /model reads the cache"
```

---

### Task 5: `--plain` REPL parity

**Files:**
- Modify: `src/cli/repl.ts:66-181` (slash handling), `:54` (the startup hint line)
- Test: `src/main.test.ts`

**Interfaces:**
- Consumes: `discoverModels` (Task 2), `saveProvider` (Task 1).
- Produces: the `/add-provider` REPL command; no new exports.

- [ ] **Step 1: Write the failing test**

`src/main.test.ts` already spawns the REPL through `$` and asserts on output; follow its existing style. Add one test that pipes `/add-provider` into a **piped (non-TTY)** session — the branch must print a usage hint naming the command's form instead of blocking on `rl.question` for input that will never come:

```ts
test("plain repl: /add-provider without a TTY prints usage instead of waiting", async () => {
  const out = await $`printf '/add-provider\n/exit\n' | bun src/main.ts --plain --db /tmp/opencode/addprov-${Date.now()}.db`.quiet().text()
  expect(out).toContain("/add-provider <name>")   // usage line, not a hung prompt
}, 30000)
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/main.test.ts`
Expected: FAIL — the output reads `unknown command` and never contains the usage form.

- [ ] **Step 3: Implement**

Add a `slash.cmd === "add-provider"` branch before the final `unknown command` (`:179`). Prompt through the existing `rl.question` for name → url → key (ANSI, via `ui.ts` helpers), validate exactly as Task 3 does, then run `discoverModels`, print the returned models with `dim()` numbering, ask `import these N models? [Y/n]`, and on yes call `saveProvider(name, { baseUrl, apiKey, models }, globalConfigPath())` — the REPL has no `globalConfigPath` prop, so import the default from core. Print `saved <name> · N models` or the failure reason in `red()`. When stdin is not a TTY, print the usage line and `continue` instead of waiting on input. Add `/add-provider` to the startup hint at `:54`.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/main.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/repl.ts src/main.test.ts
git commit -m "feat(repl): /add-provider in the plain REPL"
```

---

### Task 6: Docs — README, architecture, decision entry

**Files:**
- Modify: `README.md:18-67` (§ Configuration — a `models` row and the "never edit by hand" section), `README.md:69-131` (§ Usage — the `/add-provider` line and the plain-REPL block)
- Modify: `docs/architecture/provider.md` (`discoverModels`), `docs/architecture/tui.md` (the new picker file in the Files sentence)
- Modify: `docs/decisions/core.md` (new entry), `docs/decisions.md` (bump the Core count in the index table)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: README § Configuration**

Add to the field table: `providers.<name>.models` — *Optional cached list of model ids. Written by `/add-provider` from the endpoint's `/models`; when present, `/model` lists it instead of calling the endpoint.* Add a short paragraph stating the form writes the global file, keeps other keys, stores the key as typed (`{env:VAR}` included), and sets the file to `0600` when it holds an inline key.

- [ ] **Step 2: README § Usage**

Add `/add-provider` to the slash-command sentence: *opens a form (name, base URL, API key) where **Test** calls `<baseUrl>/models` — only a `200` with at least one model unlocks **import**, which writes the provider and every model id to the global config and makes it selectable in `/model` immediately*, plus the plain-REPL line in the code block.

- [ ] **Step 3: Architecture + decisions**

`docs/architecture/provider.md`: one paragraph on `discoverModels` — bounded (10 s default), non-throwing, resolves `{env:}`, treats `200`-with-no-models as a failure, and why it is separate from `listModels()` (which stays unbounded for the turn path). `docs/architecture/tui.md`: add `add-provider.tsx` to the Files sentence with its five phases. `docs/decisions/core.md`: append `## 2026-11-11 — A provider form writes the global config through saveProvider` recording the trade-offs the spec settled — merge-preserving write, 0600 for an inline key, slash stripping on save (not in `Provider`), cached `models` authoritative, and `defaultProvider` deliberately untouched.

- [ ] **Step 4: Full suite + doc check**

Run: `bun test`
Expected: `0 fail`, total above the 460 baseline (about 480 with the new tests).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/architecture/provider.md docs/architecture/tui.md docs/decisions/core.md docs/decisions.md
git commit -m "docs: add-provider — form, cached models, and the write path"
```
