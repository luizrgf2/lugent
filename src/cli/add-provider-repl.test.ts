import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { saveProvider } from "../core/config"
import { runAddProviderForm, existingProviderNames } from "./add-provider-repl"

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
