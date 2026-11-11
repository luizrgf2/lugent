# add-provider — visual provider registration with a model import

Date: 2026-11-11
Status: design, awaiting approval
Card: `t_118de0b4`

## Intent

Today the only way to add an LLM provider is to hand-edit
`~/.config/lugent/config.json` and guess the JSON shape. The demand is a
**visual** way to do it: a form that asks for name, base URL and API key, a
**Test** button that proves the endpoint answers, and an **import** of every
model the endpoint advertises into the global config.

The point is not a new format. It is **automating an edit the user already has
to do by hand**, correctly, once.

Original demand (literal):

> criar um sistema visual para adicionar provider de llm, de exemplo quero
> implementar algo em modelos, add-provider esse add provider me permite
> manualmente inserir a url do provider compativel com openai e a api key e o
> nome e isso deve ser salvo no lugent.json global é isso sem segredo

Clarified by the owner (2026-11-11):

1. **Where:** the global file — `~/.config/lugent/config.json`.
2. **Key format:** exactly what the global config already supports. Plain text
   stays plain text; `{env:VAR}` stays allowed. No new secret mechanism is
   invented — the feature automates the file, it does not change its format.
3. **Flow:** a **Test** button first. It calls `<baseUrl>/models`; only on `200`
   does importing become available, and it imports **every** model from
   `/models` into the global config.

## Goals

- Add a provider from inside lugent, with no text editor.
- Prove the endpoint works **before** writing anything to disk.
- Persist name, base URL, key and the full model list to the **global** config.
- Keep what is already in the file. Adding a provider must never drop
  `permissionMode`, `mcp`, `defaultProvider` or another provider.
- Make the new provider usable **in the running session** — no restart.
- Never print the key back into the transcript.

## Non-goals

- **Not** touching `defaultProvider`/`defaultModel`. The form only adds;
  switching stays in `/model`. (My call, open to veto at approval.)
- No editing or deleting existing providers.
- No OAuth, no non-OpenAI-compatible endpoints.
- No migration of hand-written `{env:VAR}` entries, and no rewriting them.
- No chat-completions validation — `/models` answering `200` is the contract.
- Not writing anything into the repo. `AGENTS.md` is explicit: *"No
  `lugent.json` belongs in this repo"*, and a project `lugent.json` would
  shadow the global one anyway (first-file-wins, `config.ts:25`).

## Constraints from `AGENTS.md`

| Rule | Consequence |
|---|---|
| `src/core/` has zero runtime dependencies | the persist path uses `node:fs` only |
| Config tests must pass an explicit `globalPath` | `saveProvider(name, cfg, path)` takes the path as a parameter; no test may read the real `~/.config` |
| `src/cli/` (plain REPL) stays ANSI-only | the REPL variant formats through `ui.ts`; no ink outside `src/cli/tui/` |
| `src/core/prompt.ts` snapshot is byte-pinned | this change must not touch the system prompt; if the snapshot moves, the change is wrong |
| TDD, test next to module, watch it fail | `config.test.ts`, `provider.test.ts`, `add-provider.test.tsx` |
| Doc updates ship with the code | `README.md` § Configuration + Usage, `docs/architecture/provider.md`, `docs/architecture/tui.md`, a `docs/decisions/core.md` entry |
| Conventional commits, docs in English | as usual |

## Approaches considered

**A — one inline form in the TUI, writing through a core function (chosen).**
`/add-provider` opens an ink overlay next to the existing pickers: three text
fields, a Test action, then a model list with a confirm. Saving goes through a
single `saveProvider()` in `src/core/config.ts`, the sibling of
`savePermissionMode()` (`config.ts:59`), which reads-modify-writes the global
file and preserves every other key. The REPL gets a line-oriented equivalent.
*Trade-off:* it is the most code — a form component, a persist function, a
loader change, and both front ends. In exchange the write path is one tested
function and the TUI gets a real form instead of another key-command.

**B — a plain slash command with arguments, no form.**
`/add-provider <name> <url> <key>` writes the config in one line.
*Trade-off:* cheapest by far, but it is not "visual", the key ends up in the
shell history and in the transcript, and there is no place for a Test step.
It fails the demand on two of its three asks.

**C — the agent does it, via prompt instructions.**
Teach the system prompt to guide the model through editing `lugent.json` with
the `write`/`edit` tools. *Trade-off:* `src/core/prompt.ts` is byte-pinned by a
golden snapshot and the `# MCP` section already carries a similar
instruction — this would grow the prefix on every turn, forever, to save a form.
Rejected: it pays a permanent prompt cost for a rare action, and it puts the
key in the model's context.

**A wins** because the Test step is the heart of the demand and only a form has
somewhere to put it.

## The design

### 1. The file shape

`providers.<name>` keeps `baseUrl` and `apiKey` exactly as today, and gains an
optional cached list:

```json
{
  "providers": {
    "9router": {
      "baseUrl": "http://localhost:20128/v1",
      "apiKey": "sk-…",
      "models": ["glm/glm-5.2", "qwen3.5:14b"]
    }
  }
}
```

The key is stored **as typed**. A user who types `{env:ROUTER_KEY}` gets that
literal string in the file, and `subEnv()` (`config.ts:21`) resolves it at load
exactly as it does today. Nothing about secret handling changes; the form just
saves the string the user would have typed into the editor.

**`models` is new and loadConfig currently drops it.** `loadConfig` rebuilds each
provider as `{ baseUrl, apiKey }` (`config.ts:31-34`), so any unknown field is
silently discarded. Without a loader change the import would be written to disk
and then ignored — a file that lies. So `ProviderConfig` gains
`models?: string[]`, and the loader keeps it when it is an array of non-empty
strings (`{env:}` is **not** substituted in model ids; they are literal).

### 2. The persist function

```ts
export function saveProvider(
  name: string,
  cfg: { baseUrl: string; apiKey?: string; models?: string[] },
  path = globalConfigPath(),
): { ok: boolean; error?: string }
```

Sibling of `savePermissionMode`: read the file (an unparseable file is replaced,
as there), merge `providers[name]`, write back with `JSON.stringify(raw, null,
2) + "\n"`. It always writes the **global** path passed in, never a project
file. A failed write returns `ok: false` with the reason instead of throwing —
the caller keeps the session-only provider and says so, matching the permission
mode's behavior.

**File mode.** A config that may now hold an inline key should not be
world-readable; the file is `664` today. When the write includes a non-empty
`apiKey`, the file is set to `0600` — the same rule `src/core/mcp/oauth/store.ts:36`
already applies to its token store, and the reason its tests assert the mode.
This is my call, not something the owner asked for: it is a permission change to
a file the user owns, so it is called out in the issue for veto.

### 3. Test before write

The Test action builds the candidate config **in memory** and calls
`<baseUrl>/models` with the same `Authorization: Bearer` header `Provider` uses
(`provider.ts:55`). `200` → the model list comes back and the import step
unlocks. Anything else → the form shows the status/error and stays locked;
nothing is written.

`Provider.listModels()` (`provider.ts:179`) has **no timeout**, unlike
`health()` (`provider.ts:186`, 8 s). Test against a host that accepts and never
answers would hang the overlay forever, so the test path needs a bounded call —
either a timeout argument on `listModels` or the existing `AbortSignal.timeout`
pattern. A trailing slash on `baseUrl` must not produce `//models`.

### 4. Import and use, without a restart

On confirm, `saveProvider` writes, then the App pushes the new provider into the
live `env.config.providers` object so `/model` lists it immediately, and appends
a `system` transcript line (`9router · 4 models imported`). The key is never
echoed — the form shows it masked while typing.

`/model`'s model level prefers the **cached** `models` list and falls back to a
live `listModels()` when the provider has none (`app.tsx:289-294`,
`model-picker.tsx`). That is what makes the import worth doing: the picker works
even when the endpoint is briefly down, and the list is the user's confirmed one.

### 5. The two front ends

- **TUI:** new `src/cli/tui/add-provider.tsx`, wired as `/add-provider` in
  `app.tsx` beside `/model` and `/permissions` (including the `overlay` state
  union and the slash completion list).
- **Plain REPL:** `/add-provider` in `repl.ts`, line by line through `readline`
  (name → url → key → test → confirm), formatted with `ui.ts`. A non-TTY piped
  session must not sit waiting for input it will never get — it prints usage and
  returns.

### 6. Validation, cheaply

Name: non-empty, no whitespace, not `/` — it becomes a JSON key and a picker row.
URL: must start with `http://` or `https://`; a URL without `/v1` is accepted
(the user may have a gateway that serves `/models` at another prefix) but the
form warns, because the README says the base URL must include `/v1`.
Name collision with an existing provider asks before overwriting.

## Resolved in the builder check

Six questions a fresh builder could not answer from the document alone. All are
settled here; none needs the owner.

**1. A project `lugent.json` shadows what we just wrote.** `loadConfig` is
first-file-wins (`config.ts:26`), so in a repo whose `lugent.json` declares
`providers`, the entry written to the global file is invisible on the next
launch. The form **warns and still saves**: when `<projectRoot>/lugent.json`
exists and declares a non-empty `providers`, the result line says the provider
was saved globally but is shadowed in this directory until that file changes.
`saveProvider` stays free of `projectRoot` — the App passes a boolean, so the
persist function keeps one job.

**2. `{env:VAR}` must be resolved for Test and for the in-session push.**
Typing `{env:ROUTER_KEY}` stores that literal string (the file format is
unchanged), but the Test call and the live `env.config.providers` push run
before/outside `loadConfig`, which is the only place `subEnv()` currently runs.
Both paths resolve the key through `subEnv()` (`config.ts:21`) — the same
function, same semantics. A `{env:VAR}` that resolves to `""` is reported as
"environment variable not set" instead of sending an unauthenticated request and
blaming the server. This is what makes "no restart" true for command
substitution, not just for literal keys.

**3. Re-running for an existing name preserves an empty key field.** Re-running
`/add-provider` is the only refresh path (non-goal: no editing), so it will be
used, and writing `apiKey: ""` would silently destroy a working key. Merge rule:
an empty key field keeps the existing `apiKey`; the `models` list is always
replaced by the fresh import. The overwrite confirmation says which of the two
is happening.

**4. Trailing slashes are normalized on save, not only in Test.** `Provider`
concatenates raw (`` `${this.cfg.baseUrl}/chat/completions` ``,
`provider.ts:103`), so a Test-only fix would produce the worst case: Test passes,
the config is saved with the slash, and every later chat 404s. `saveProvider`
strips trailing slashes from `baseUrl` before writing. `Provider` is left
untouched — normalizing there would change existing behavior and needs its own
tests for hand-written configs, which is a separate change. The "stored as
typed" promise covers the **key**, not the URL; the spec says so explicitly now.

**5. The cached `models` list is authoritative.** No merge, no live refresh from
the picker. Re-running `/add-provider` for the same name re-imports and replaces
the list — that is the refresh path, and it is the one the demand asks for. The
`/model` picker reads `cfg.models` when present and only calls `listModels()`
when the list is absent (`app.tsx:289-294`), so a provider whose endpoint is
briefly down still lists its models.

**6. A `200` with no models is not a successful import.** Some gateways answer
`{"data":[]}`, and non-JSON bodies throw inside `res.json()`. Test requires
`200` **and** at least one parsed model id to unlock the import. A `200` with an
empty or unparsable list is reported as "endpoint answered but advertised no
models", and the form then offers to save the provider **without** a `models`
key — so `models` is optional in `saveProvider` and the provider is still usable.

### Known limitation, escalated to the issue (not fixed here)

Because the form does not set `defaultProvider`, a first-run user with an empty
config still has no provider selected right after adding their only one. They
can select it with `/model` (the TUI picker lists it immediately), so this is a
rough edge, not a blocker — and choosing a default is the decision the owner
declined to make in this scope.

## What is left to the builder

- Whether the Test timeout is a `listModels(timeoutMs)` argument or a wrapper —
  keep the default call unbounded so existing behavior and tests do not shift.
- Exact field navigation (Tab/arrows/Enter) and the visual layout of the form.
- Whether the model-import step is a checklist (pick a subset) or all-or-nothing.
  The demand says "importar todos", so all-or-nothing is the default; a checklist
  is acceptable if it stays one extra step.
- The masking character and whether a reveal toggle exists.
- Test fixtures for the Test call: a `fetch` stub, never a real network call.
