import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { saveProvider, providerEntryInFile } from "../core/config"
import { discoverModels } from "../core/provider"
import { runAddProviderForm, existingProviderNames } from "./add-provider-repl"
import { readSecret } from "./secret-prompt"

const SEEDED = {
  providers: { existing: { baseUrl: "http://old/v1", apiKey: "sk-old", models: ["m-old"] } },
  permissionMode: "yolo",
  defaultProvider: "existing",
}

function fixture() {
  const dir = mkdtempSync("/tmp/opencode/addprov-repl-")
  const path = `${dir}/config.json`
  writeFileSync(path, JSON.stringify(SEEDED))
  return {
    path,
    read: () => JSON.parse(readFileSync(path, "utf8")),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/** Scripted answers; every prompt is recorded so a test can assert one was asked. */
function scripted(list: string[]) {
  const queue = [...list]
  const prompts: string[] = []
  return {
    prompts,
    ask: async (prompt: string) => {
      prompts.push(prompt)
      const next = queue.shift()
      if (next === undefined) throw new Error(`unexpected prompt (no answer left): ${prompt}`)
      return next
    },
  }
}

const foundTwo = async () => ({ ok: true, models: ["alpha", "beta"] })

test("plain repl: an existing provider is not overwritten without a [y/N] confirmation", async () => {
  // Spec §"Validation, cheaply": "Name collision with an existing provider asks
  // before overwriting." The TUI form asks; the REPL silently rewrote the entry,
  // destroying a working base url, key and cached model list on one `enter`.
  const f = fixture()
  const s = scripted(["http://new/v1", "sk-new", "y", "n"])   // url, key, import, overwrite
  const r = await runAddProviderForm({
    name: "existing",
    ask: s.ask,
    discover: foundTwo,
    existing: ["existing"],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("cancelled")
    expect(s.prompts.some(p => /overwrite existing\?/.test(p))).toBe(true)
    // Answering no must leave the file byte-for-byte decision-identical.
    const after = f.read()
    expect(after.providers.existing).toEqual(SEEDED.providers.existing)
    expect(after.permissionMode).toBe("yolo")
  } finally { f.cleanup() }
})

test("plain repl: answering y overwrites, keeping the keys this save does not own", async () => {
  const f = fixture()
  const s = scripted(["http://new/v1", "sk-new", "y", "y"])
  const r = await runAddProviderForm({
    name: "existing",
    ask: s.ask,
    discover: foundTwo,
    existing: ["existing"],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("saved")
    if (r.status !== "saved") throw new Error("unreachable")
    expect(r.imported).toBe(2)
    const after = f.read()
    expect(after.providers.existing).toEqual({ baseUrl: "http://new/v1", apiKey: "sk-new", models: ["alpha", "beta"] })
    expect(after.permissionMode).toBe("yolo")   // unrelated keys survive
    expect(after.defaultProvider).toBe("existing")
  } finally { f.cleanup() }
})

test("plain repl: an empty answer to the overwrite prompt is a no — the default is not destructive", async () => {
  // Every other prompt in this flow defaults to yes ([Y/n]). This one replaces a
  // working provider, so a bare `enter` has to mean no.
  const f = fixture()
  const s = scripted(["http://new/v1", "sk-new", "y", ""])
  const r = await runAddProviderForm({
    name: "existing",
    ask: s.ask,
    discover: foundTwo,
    existing: ["existing"],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("cancelled")
    expect(f.read().providers.existing).toEqual(SEEDED.providers.existing)
  } finally { f.cleanup() }
})

test("plain repl: a new provider name is written without asking for confirmation", async () => {
  const f = fixture()
  const s = scripted(["http://new/v1", "sk-new", "y"])   // no overwrite answer scripted
  const r = await runAddProviderForm({
    name: "fresh",
    ask: s.ask,
    discover: foundTwo,
    existing: ["existing"],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("saved")
    expect(s.prompts.some(p => /overwrite/.test(p))).toBe(false)
    expect(f.read().providers.fresh).toEqual({ baseUrl: "http://new/v1", apiKey: "sk-new", models: ["alpha", "beta"] })
    expect(f.read().providers.existing).toEqual(SEEDED.providers.existing)
  } finally { f.cleanup() }
})

test("plain repl: a name only in the global file still gets the overwrite prompt", async () => {
  // `loadConfig` is first-file-wins: in a repo whose `lugent.json` declares
  // providers, the global entries never reach `env.config.providers`. Deriving
  // `existing` from the live map alone would therefore overwrite a global entry
  // the user cannot even see from here, with no prompt.
  const f = fixture()
  expect(existingProviderNames([], f.path)).toContain("existing")
  const s = scripted(["http://new/v1", "sk-new", "y", "n"])
  const r = await runAddProviderForm({
    name: "existing",
    ask: s.ask,
    discover: foundTwo,
    existing: existingProviderNames([], f.path),   // live map is shadowed and empty
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("cancelled")
    expect(s.prompts.some(p => /overwrite existing\?/.test(p))).toBe(true)
    expect(f.read().providers.existing).toEqual(SEEDED.providers.existing)
  } finally { f.cleanup() }
})

test("plain repl: the overwrite prompt says what this save replaces and what it keeps", async () => {
  // An existing name with a models-less Test keeps its cached list (decision 5),
  // and the prompt has to say so — the TUI's confirm text is the reference.
  const f = fixture()
  const s = scripted(["http://new/v1", "sk-new", "y", "y"])   // url, key, save-anyway?, overwrite
  const r = await runAddProviderForm({
    name: "existing",
    ask: s.ask,
    discover: async () => ({ ok: false, models: [], noModels: true, error: "endpoint answered but advertised no models" }),
    existing: ["existing"],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("saved")
    const prompt = s.prompts.find(p => /overwrite existing\?/.test(p)) ?? ""
    expect(prompt).toContain("base url")
    expect(prompt).toContain("keeps its current model list")
    expect(prompt).toContain("[y/N]")
    // `saveProvider` retained the cached list — the prompt promised exactly that.
    expect(f.read().providers.existing.models).toEqual(["m-old"])
  } finally { f.cleanup() }
})

test("plain repl: a blank key field Tests with the key the save will keep", async () => {
  // Decision 3 makes re-running `/add-provider` the only refresh path, and the
  // prompt invites a blank key ("blank keeps the stored one"). The write does
  // retain it — but the Test was built from the form fields alone, so it went
  // out with no `Authorization` header at all and any auth-enforcing endpoint
  // answered 401, making the refresh path unusable without the key at hand.
  const f = fixture()
  const seen: any[] = []
  const s = scripted(["http://old/v1", "", "y", "y"])           // url, blank key, import, overwrite
  const r = await runAddProviderForm({
    name: "existing",
    ask: s.ask,
    discover: async (cfg: any) => { seen.push({ ...cfg }); return { ok: true, models: ["alpha", "beta"] } },
    existing: ["existing"],
    // The Test's key comes from the file the save writes — the same source the
    // write itself keeps the key from.
    storedEntry: name => providerEntryInFile(name, f.path),
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(seen).toEqual([{ baseUrl: "http://old/v1", apiKey: "sk-old" }])
    expect(r.status).toBe("saved")
    // The file still holds the original key, untouched by the blank field.
    expect(f.read().providers.existing.apiKey).toBe("sk-old")
  } finally { f.cleanup() }
})

test("plain repl: a stored {env:VAR} key is resolved for the Test, raw in the file", async () => {
  // Decision 2 makes no exception for a key the user did not retype: the Test
  // resolves it through `subEnv()` like every other path, and an env var that is
  // unset is reported as such instead of sending an unauthenticated request.
  process.env.LUGENT_ADDPROV_STORED = "sk-from-env"
  const dir = mkdtempSync("/tmp/opencode/addprov-repl-env-")
  const path = `${dir}/config.json`
  writeFileSync(path, JSON.stringify({
    providers: { existing: { baseUrl: "http://old/v1", apiKey: "{env:LUGENT_ADDPROV_STORED}" } },
  }))
  const auths: (string | undefined)[] = []
  const fetchFn = (async (_url: string, init: any) => {
    auths.push(init?.headers?.authorization)
    return new Response(JSON.stringify({ data: [{ id: "alpha" }] }), { status: 200 })
  }) as any
  const s = scripted(["http://old/v1", "", "y", "y"])
  const r = await runAddProviderForm({
    name: "existing",
    ask: s.ask,
    // The real `discoverModels`, so the resolution is the production one.
    discover: (cfg: any) => discoverModels(cfg, { fetchFn }),
    existing: ["existing"],
    storedEntry: name => providerEntryInFile(name, path),
    save: (n, cfg) => saveProvider(n, cfg, path),
  })
  try {
    expect(auths).toEqual(["Bearer sk-from-env"])
    expect(r.status).toBe("saved")
    // The file keeps the reference, not the secret.
    expect(JSON.parse(readFileSync(path, "utf8")).providers.existing.apiKey).toBe("{env:LUGENT_ADDPROV_STORED}")
  } finally {
    delete process.env.LUGENT_ADDPROV_STORED
    rmSync(dir, { recursive: true, force: true })
  }
})

test("plain repl: a typed key still wins over the stored one", async () => {
  const f = fixture()
  const seen: any[] = []
  const s = scripted(["http://old/v1", "sk-typed", "y", "y"])
  await runAddProviderForm({
    name: "existing",
    ask: s.ask,
    discover: async (cfg: any) => { seen.push({ ...cfg }); return { ok: true, models: ["alpha"] } },
    existing: ["existing"],
    storedEntry: name => providerEntryInFile(name, f.path),
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(seen[0].apiKey).toBe("sk-typed")
  } finally { f.cleanup() }
})

test("plain repl: a new name with a blank key Tests with no key, not some other provider's", async () => {
  // The stored-key lookup is per name: falling back to any key in the file would
  // authenticate the Test as a different provider and hide a missing credential.
  const f = fixture()
  const seen: any[] = []
  const s = scripted(["http://new/v1", "", "y"])
  await runAddProviderForm({
    name: "fresh",
    ask: s.ask,
    discover: async (cfg: any) => { seen.push({ ...cfg }); return { ok: true, models: ["alpha"] } },
    existing: existingProviderNames([], f.path),
    storedEntry: name => providerEntryInFile(name, f.path),
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(seen[0]).toEqual({ baseUrl: "http://new/v1", apiKey: "" })
  } finally { f.cleanup() }
})

test("plain repl: the key prompt goes through the masking reader, everything else through ask", async () => {
  // The README promises the key is never printed back. `readline` echoes, so the
  // plain REPL needs a masked read for exactly that one prompt — and only that
  // one, since the rest of the flow's answers are not secret.
  const f = fixture()
  const asked: string[] = []
  const secret: string[] = []
  const said: string[] = []
  await runAddProviderForm({
    name: "fresh",
    ask: async (q: string) => { asked.push(q); return q.startsWith("base url") ? "http://n/v1" : "y" },
    askSecret: async (q: string) => { secret.push(q); return "sk-hidden" },
    say: l => said.push(l),
    discover: async () => ({ ok: true, models: ["alpha"] }),
    existing: [],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(secret).toHaveLength(1)
    expect(secret[0]).toContain("api key")
    expect(asked.some(q => /api key/.test(q))).toBe(false)
    expect(f.read().providers.fresh.apiKey).toBe("sk-hidden")
  } finally { f.cleanup() }
})

test("plain repl: a front end without a masking reader still gets the key prompt", async () => {
  // `askSecret` is optional: the flow must stay usable (and testable) without a TTY.
  const f = fixture()
  const asked: string[] = []
  await runAddProviderForm({
    name: "fresh",
    ask: async (q: string) => { asked.push(q); return q.startsWith("base url") ? "http://n/v1" : q.startsWith("api key") ? "sk-plain" : "y" },
    discover: async () => ({ ok: true, models: ["alpha"] }),
    existing: [],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(asked.some(q => /api key/.test(q))).toBe(true)
    expect(f.read().providers.fresh.apiKey).toBe("sk-plain")
  } finally { f.cleanup() }
})

test("plain repl: Ctrl+C at the key prompt cancels the form instead of throwing", async () => {
  // `readSecret` rejects with `Error("cancelled")` on ^C — that is the contract,
  // and it is the documented abort key. Nothing caught it: the rejection escaped
  // `repl.ts`, Bun printed a stack and exited 1, so a user who changed their mind
  // at the key prompt lost the whole session (reproduced 3/3 on a real pty).
  const f = fixture()
  const r = await runAddProviderForm({
    name: "fresh",
    ask: async (q: string) => q.startsWith("base url") ? "http://n/v1" : "y",
    askSecret: async () => { throw new Error("cancelled") },
    discover: async () => ({ ok: true, models: ["alpha"] }),
    existing: [],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    // A cancellation, not a thrown error and not an "invalid" line: the REPL
    // prints the same `cancelled — nothing written` it prints for a `n`.
    expect(r).toEqual({ status: "cancelled" })
    expect(f.read()).toEqual(SEEDED)
  } finally { f.cleanup() }
})

test("plain repl: a Ctrl+C on the key prompt leaves the answers already given alone", async () => {
  // The abort must not reach the save: the file is untouched, and the only
  // prompts answered were the ones before the cancel.
  const f = fixture()
  const asked: string[] = []
  const r = await runAddProviderForm({
    name: "existing",
    ask: async (q: string) => { asked.push(q); return q.startsWith("base url") ? "http://new/v1" : "y" },
    askSecret: async () => { throw new Error("cancelled") },
    discover: async () => ({ ok: true, models: ["alpha"] }),
    existing: ["existing"],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("cancelled")
    expect(f.read()).toEqual(SEEDED)
    expect(asked.some(q => /overwrite/.test(q))).toBe(false)
  } finally { f.cleanup() }
})

test("plain repl: a key corrected with the arrow keys is saved exactly as typed", async () => {
  // End to end through the real masked reader: the field renders one dot per
  // character, so a corrupted secret is invisible on screen. The reviewed bug
  // saved `sk-ab[Dcd` after ← while editing — this walks the same keystrokes
  // through the form and asserts what lands on disk.
  const f = fixture()
  const { EventEmitter } = await import("node:events")
  const input: any = new EventEmitter()
  input.setRawMode = () => input
  input.resume = () => input
  const out = { write: () => true }
  const r = await runAddProviderForm({
    name: "fresh",
    ask: async (q: string) => q.startsWith("base url") ? "http://n/v1" : "y",
    askSecret: () => {
      const p = readSecret({ prompt: "api key: ", input, output: out })
      input.emit("data", Buffer.from("sk-ab"))
      input.emit("data", Buffer.from("\u001b[D"))       // ←
      input.emit("data", Buffer.from("\u001b[C"))       // →
      input.emit("data", Buffer.from("cd\r"))
      return p
    },
    discover: async () => ({ ok: true, models: ["alpha"] }),
    existing: [],
    save: (n, cfg) => saveProvider(n, cfg, f.path),
  })
  try {
    expect(r.status).toBe("saved")
    expect(f.read().providers.fresh.apiKey).toBe("sk-abcd")
  } finally { f.cleanup() }
})
