import { describe, test, expect } from "bun:test"
import { subEnv, loadConfig, parseMcpServer, loadMcpConfig, savePermissionMode, saveProvider, providerNamesInFile } from "./config"
import { rmSync, writeFileSync, mkdirSync, readFileSync, statSync } from "node:fs"

describe("subEnv", () => {
  test("substitutes {env:VAR}", () => {
    process.env.LUGENT_TEST_KEY = "sekret"
    expect(subEnv("{env:LUGENT_TEST_KEY}")).toBe("sekret")
    expect(subEnv("prefix-{env:LUGENT_TEST_KEY}-suffix")).toBe("prefix-sekret-suffix")
  })
  test("unknown var becomes empty string", () => {
    expect(subEnv("{env:LUGENT_NOPE}")).toBe("")
  })
})

describe("loadConfig", () => {
  test("reads lugent.json from root and substitutes env", () => {
    const dir = `/tmp/opencode/cfg-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    process.env.LUGENT_TEST_KEY = "sekret"
    writeFileSync(`${dir}/lugent.json`, JSON.stringify({
      providers: { local: { baseUrl: "http://localhost:11434/v1", apiKey: "{env:LUGENT_TEST_KEY}" } },
      defaultProvider: "local",
      defaultModel: "qwen3.6-35b",
    }))
    const cfg = loadConfig(dir)
    expect(cfg.providers.local.baseUrl).toBe("http://localhost:11434/v1")
    expect(cfg.providers.local.apiKey).toBe("sekret")
    expect(cfg.defaultModel).toBe("qwen3.6-35b")
    rmSync(dir, { recursive: true, force: true })
  })
  test("no config anywhere returns empty providers", () => {
    const cfg = loadConfig(`/tmp/opencode/nope-${Date.now()}`, `/tmp/opencode/nope-global-${Date.now()}.json`)
    expect(cfg.providers).toEqual({})
    expect(cfg.defaultProvider).toBe("")
  })

  test("falls back to global config when root has none", () => {
    const dir = `/tmp/opencode/cfg2-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    const global = `/tmp/opencode/global-${Date.now()}.json`
    writeFileSync(global, JSON.stringify({
      providers: { g: { baseUrl: "http://g/v1" } },
      defaultProvider: "g", defaultModel: "m",
    }))
    const cfg = loadConfig(dir, global)
    expect(cfg.providers.g.baseUrl).toBe("http://g/v1")
    expect(cfg.defaultModel).toBe("m")
    rmSync(dir, { recursive: true, force: true })
    rmSync(global, { force: true })
  })

  test("reads defaultAgent", () => {
    const dir = `/tmp/opencode/cfg-agent-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/lugent.json`, JSON.stringify({
      providers: {}, defaultProvider: "", defaultModel: "", defaultAgent: "reviewer",
    }))
    expect(loadConfig(dir).defaultAgent).toBe("reviewer")
    rmSync(dir, { recursive: true, force: true })
  })

  test("missing defaultAgent is undefined", () => {
    const dir = `/tmp/opencode/cfg-noagent-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/lugent.json`, JSON.stringify({ providers: {}, defaultProvider: "", defaultModel: "" }))
    expect(loadConfig(dir).defaultAgent).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })

  test("permissionMode defaults to normal, project overrides global", () => {
    const dir = `/tmp/opencode/cfg-perm-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    const global = `/tmp/opencode/perm-global-${Date.now()}.json`
    writeFileSync(global, JSON.stringify({ providers: {}, defaultProvider: "", defaultModel: "", permissionMode: "yolo" }))
    writeFileSync(`${dir}/lugent.json`, JSON.stringify({ providers: {}, defaultProvider: "", defaultModel: "", permissionMode: "normal" }))
    expect(loadConfig(dir, global).permissionMode).toBe("normal")
    rmSync(`${dir}/lugent.json`)
    expect(loadConfig(dir, global).permissionMode).toBe("yolo")   // global default stands
    rmSync(dir, { recursive: true, force: true })
    rmSync(global, { force: true })
  })

  test("an invalid permissionMode warns and falls back to normal", () => {
    const dir = `/tmp/opencode/cfg-perm-bad-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    const global = `/tmp/opencode/nope-${Date.now()}.json`
    writeFileSync(`${dir}/lugent.json`, JSON.stringify({ providers: {}, defaultProvider: "", defaultModel: "", permissionMode: "sudo" }))
    const warns: string[] = []
    const orig = console.warn
    console.warn = (m: string) => { warns.push(String(m)) }
    try {
      expect(loadConfig(dir, global).permissionMode).toBe("normal")
      expect(warns.join("\n")).toMatch(/permissionMode/)
    } finally { console.warn = orig }
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("savePermissionMode", () => {
  test("creates the global config when missing, updating only permissionMode", () => {
    const global = `/tmp/opencode/save-mode-${Date.now()}.json`
    rmSync(global, { force: true })
    savePermissionMode("yolo", global)
    expect(JSON.parse(readFileSync(global, "utf8"))).toEqual({ permissionMode: "yolo" })
    savePermissionMode("normal", global)
    expect(JSON.parse(readFileSync(global, "utf8"))).toEqual({ permissionMode: "normal" })
    rmSync(global, { force: true })
  })

  test("preserves existing keys and never touches the project file", () => {
    const dir = `/tmp/opencode/save-mode-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    const global = `${dir}/global.json`
    writeFileSync(global, JSON.stringify({ defaultProvider: "9router", permissionMode: "yolo" }))
    writeFileSync(`${dir}/lugent.json`, JSON.stringify({ defaultProvider: "ollama" }))
    savePermissionMode("normal", global)
    expect(JSON.parse(readFileSync(global, "utf8"))).toEqual({ defaultProvider: "9router", permissionMode: "normal" })
    expect(JSON.parse(readFileSync(`${dir}/lugent.json`, "utf8"))).toEqual({ defaultProvider: "ollama" })
    rmSync(dir, { recursive: true, force: true })
  })

  test("a malformed global file is replaced, not merged", () => {
    const global = `/tmp/opencode/save-mode-bad-${Date.now()}.json`
    writeFileSync(global, "{not json")
    savePermissionMode("yolo", global)
    expect(JSON.parse(readFileSync(global, "utf8"))).toEqual({ permissionMode: "yolo" })
    rmSync(global, { force: true })
  })

  test("a failing write is reported and logged, not thrown", () => {
    const dir = `/tmp/opencode/save-mode-fail-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    const warns: string[] = []
    const orig = console.warn
    console.warn = (m: string) => { warns.push(String(m)) }
    try {
      expect(savePermissionMode("yolo", dir)).toBe(false)   // path is a directory → write fails
      expect(warns.join("\n")).toMatch(/permission mode/)
    } finally { console.warn = orig }
    rmSync(dir, { recursive: true, force: true })
  })

  test("returns true when the mode is persisted", () => {
    const global = `/tmp/opencode/save-mode-ok-${Date.now()}.json`
    expect(savePermissionMode("yolo", global)).toBe(true)
    expect(JSON.parse(readFileSync(global, "utf8")).permissionMode).toBe("yolo")
    rmSync(global, { force: true })
  })
})

describe("parseMcpServer", () => {
  test("local server parses command array", () => {
    expect(parseMcpServer("cd", { type: "local", command: ["npx", "-y", "chrome-devtools-mcp@latest"] }))
      .toEqual({ type: "local", command: ["npx", "-y", "chrome-devtools-mcp@latest"] })
  })
  test("remote server accepts the http alias", () => {
    expect(parseMcpServer("tf", { type: "http", url: "https://x/mcp" }))
      .toEqual({ type: "http", url: "https://x/mcp" })
  })
  test("type is inferred when absent", () => {
    expect(parseMcpServer("a", { url: "https://x/mcp" })?.type).toBe("remote")
    expect(parseMcpServer("b", { command: ["node", "s.js"] })?.type).toBe("local")
  })
  test("local without command is dropped", () => {
    expect(parseMcpServer("bad", { type: "local", command: [] })).toBeUndefined()
  })
  test("remote without http url is dropped", () => {
    expect(parseMcpServer("bad", { type: "remote", url: "ftp://x" })).toBeUndefined()
  })
  test("enabled false is kept and marked disabled", () => {
    expect(parseMcpServer("off", { type: "remote", url: "https://x/mcp", enabled: false }))
      .toEqual({ type: "remote", url: "https://x/mcp", enabled: false })
  })
  test("timeout and env substitution", () => {
    process.env.MCP_TEST_TOKEN = "tok"
    const cfg = parseMcpServer("s", { type: "remote", url: "https://x/mcp", timeout: 5000, headers: { Authorization: "Bearer {env:MCP_TEST_TOKEN}" } })
    expect(cfg).toEqual({ type: "remote", url: "https://x/mcp", timeout: 5000, headers: { Authorization: "Bearer tok" } })
  })
  test("scopes is an optional string array", () => {
    expect(parseMcpServer("s", { type: "remote", url: "https://x/mcp", scopes: ["agents:read", "knowledge:write"] }))
      .toEqual({ type: "remote", url: "https://x/mcp", scopes: ["agents:read", "knowledge:write"] })
    // absent stays absent: "no scopes" and "these scopes" are different requests
    expect(parseMcpServer("s", { type: "remote", url: "https://x/mcp" })).toEqual({ type: "remote", url: "https://x/mcp" })
  })
  test("a bad scopes value warns and drops", () => {
    const warns: string[] = []
    const orig = console.warn
    console.warn = (m: string) => { warns.push(String(m)) }
    try {
      expect(parseMcpServer("s", { type: "remote", url: "https://x/mcp", scopes: "agents:read" }))
        .toEqual({ type: "remote", url: "https://x/mcp" })
      expect(warns.join("\n")).toMatch(/scopes/)
    } finally { console.warn = orig }
  })
})

describe("loadMcpConfig", () => {
  const write = (p: string, mcp: unknown) => writeFileSync(p, JSON.stringify({ providers: {}, defaultProvider: "", defaultModel: "", mcp }))

  test("merges global and project, project replaces the whole entry", () => {
    const dir = `/tmp/opencode/mcp-${Date.now()}`
    const global = `/tmp/opencode/mcp-global-${Date.now()}.json`
    mkdirSync(dir, { recursive: true })
    write(global, { a: { type: "remote", url: "https://global/mcp" }, b: { type: "remote", url: "https://b/mcp" } })
    write(`${dir}/lugent.json`, { a: { type: "remote", url: "https://project/mcp" } })
    const cfg = loadMcpConfig(dir, global)
    expect(cfg.a.url).toBe("https://project/mcp")
    expect(cfg.b.url).toBe("https://b/mcp")
    rmSync(dir, { recursive: true, force: true })
    rmSync(global, { force: true })
  })

  test("project can disable a global server by repeating it disabled", () => {
    const dir = `/tmp/opencode/mcp-off-${Date.now()}`
    const global = `/tmp/opencode/mcp-off-global-${Date.now()}.json`
    mkdirSync(dir, { recursive: true })
    write(global, { a: { type: "remote", url: "https://a/mcp" } })
    write(`${dir}/lugent.json`, { a: { type: "remote", url: "https://a/mcp", enabled: false } })
    expect(loadMcpConfig(dir, global)).toEqual({ a: { type: "remote", url: "https://a/mcp", enabled: false } })
    rmSync(dir, { recursive: true, force: true })
    rmSync(global, { force: true })
  })

  test("no mcp key anywhere yields an empty map", () => {
    expect(loadMcpConfig(`/tmp/opencode/nomcp-${Date.now()}`, `/tmp/opencode/nomcp-g-${Date.now()}.json`)).toEqual({})
  })

  test("a bare enabled:false marker disables a server declared in the other file", () => {
    const dir = `/tmp/opencode/mcp-marker-${Date.now()}`
    const global = `/tmp/opencode/mcp-marker-global-${Date.now()}.json`
    mkdirSync(dir, { recursive: true })
    write(global, { a: { type: "remote", url: "https://a/mcp" }, b: { type: "local", command: ["bun", "x.ts"] } })
    write(`${dir}/lugent.json`, { a: { enabled: false } })
    const cfg = loadMcpConfig(dir, global)
    expect(cfg.a).toEqual({ type: "remote", url: "https://a/mcp", enabled: false })   // disabled, not dropped
    expect(cfg.b).toEqual({ type: "local", command: ["bun", "x.ts"] })                // untouched
    rmSync(dir, { recursive: true, force: true })
    rmSync(global, { force: true })
  })

  test("a bare enabled:false marker for an unknown server is dropped", () => {
    const dir = `/tmp/opencode/mcp-marker-${Date.now()}-x`
    const global = `/tmp/opencode/mcp-marker-global-${Date.now()}-x.json`
    mkdirSync(dir, { recursive: true })
    write(global, {})
    write(`${dir}/lugent.json`, { ghost: { enabled: false } })
    expect(loadMcpConfig(dir, global)).toEqual({})
    rmSync(dir, { recursive: true, force: true })
    rmSync(global, { force: true })
  })

  test("a global marker disables a server only the project declares", () => {
    const dir = `/tmp/opencode/mcp-marker-${Date.now()}-y`
    const global = `/tmp/opencode/mcp-marker-global-${Date.now()}-y.json`
    mkdirSync(dir, { recursive: true })
    write(global, { a: { enabled: false } })
    write(`${dir}/lugent.json`, { a: { type: "remote", url: "https://a/mcp" } })
    // the user's own file can switch off a server a repo declares
    expect(loadMcpConfig(dir, global)).toEqual({ a: { type: "remote", url: "https://a/mcp", enabled: false } })
    rmSync(dir, { recursive: true, force: true })
    rmSync(global, { force: true })
  })
})

describe("defaultSubagentModel", () => {
  test("parses a provider/model pair", () => {
    const dir = `/tmp/opencode/cfg-dsm-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/lugent.json`, JSON.stringify({
      providers: {}, defaultProvider: "", defaultModel: "",
      defaultSubagentModel: "zai/glm-5.3-flash",
    }))
    expect(loadConfig(dir).defaultSubagentModel).toEqual({ provider: "zai", model: "glm-5.3-flash" })
    rmSync(dir, { recursive: true, force: true })
  })

  test("keeps slashes inside the model part", () => {
    const dir = `/tmp/opencode/cfg-dsm2-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/lugent.json`, JSON.stringify({
      providers: {}, defaultProvider: "", defaultModel: "",
      defaultSubagentModel: "9router/openai/gpt-4o",
    }))
    expect(loadConfig(dir).defaultSubagentModel).toEqual({ provider: "9router", model: "openai/gpt-4o" })
    rmSync(dir, { recursive: true, force: true })
  })

  test("a value without a provider warns and is ignored", () => {
    const dir = `/tmp/opencode/cfg-dsm3-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/lugent.json`, JSON.stringify({
      providers: {}, defaultProvider: "", defaultModel: "",
      defaultSubagentModel: "flash",
    }))
    expect(loadConfig(dir).defaultSubagentModel).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })

  test("absent stays undefined", () => {
    const dir = `/tmp/opencode/cfg-dsm4-${Date.now()}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/lugent.json`, JSON.stringify({ providers: {}, defaultProvider: "", defaultModel: "" }))
    expect(loadConfig(dir).defaultSubagentModel).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("saveProvider", () => {
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

  test("saveProvider returns a live entry with the {env:VAR} reference resolved", () => {
    process.env.LUGENT_LIVE_KEY = "sekret"
    const p = `/tmp/opencode/save-live-env-${Date.now()}.json`
    const r = saveProvider("r", { baseUrl: "http://r/v1/", apiKey: "{env:LUGENT_LIVE_KEY}", models: ["m"] }, p)
    // The session gets the secret — `Provider.headers()` sends its apiKey verbatim,
    // so an unresolved reference there is a literal `Bearer {env:VAR}` and a 401.
    expect(r.live).toEqual({ baseUrl: "http://r/v1", apiKey: "sekret", models: ["m"] })
    // The file keeps the reference: the format is unchanged, `loadConfig` resolves it.
    expect(JSON.parse(readFileSync(p, "utf8")).providers.r.apiKey).toBe("{env:LUGENT_LIVE_KEY}")
    rmSync(p, { force: true })
  })

  test("saveProvider's live entry keeps the stored key when the field is empty", () => {
    const p = `/tmp/opencode/save-live-keep-${Date.now()}.json`
    writeFileSync(p, JSON.stringify({ providers: { r: { baseUrl: "http://r/v1", apiKey: "sk-old" } } }))
    const r = saveProvider("r", { baseUrl: "http://r/v1", models: ["x"] }, p)
    expect(r.live.apiKey).toBe("sk-old")
    expect(r.live.models).toEqual(["x"])
    rmSync(p, { force: true })
  })

  test("saveProvider omits a reference that resolves to nothing from the live entry", () => {
    const p = `/tmp/opencode/save-live-unset-${Date.now()}.json`
    const r = saveProvider("r", { baseUrl: "http://r/v1", apiKey: "{env:LUGENT_LIVE_UNSET}" }, p)
    // No key on the session entry at all — `Bearer ` with an empty token is worse
    // than an unauthenticated request, whose 401 at least names the real problem.
    expect(r.live.apiKey).toBeUndefined()
    expect(JSON.parse(readFileSync(p, "utf8")).providers.r.apiKey).toBe("{env:LUGENT_LIVE_UNSET}")
    rmSync(p, { force: true })
  })

  test("saveProvider mirrors the file's models into the live entry", () => {
    const p = `/tmp/opencode/save-live-models-${Date.now()}.json`
    saveProvider("r", { baseUrl: "http://r/v1", models: ["a"] }, p)
    // A models-less save keeps the previous list on disk, so the session must see it too.
    const r = saveProvider("r", { baseUrl: "http://r/v1" }, p)
    expect(r.live.models).toEqual(["a"])
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

  test("providerNamesInFile reports what the save would overwrite, shadowed entries included", () => {
    // The overwrite gate has to be computed from the file being written, not from
    // the live config: `loadConfig` is first-file-wins, so in a repo whose
    // `lugent.json` declares providers the live map cannot see the global
    // entries — and those are exactly the ones a save would destroy.
    const p = `/tmp/opencode/names-${Date.now()}.json`
    writeFileSync(p, JSON.stringify({ providers: { globalA: { baseUrl: "http://a/v1" }, globalB: { baseUrl: "http://b/v1" } } }))
    expect(providerNamesInFile(p).sort()).toEqual(["globalA", "globalB"])
    // Missing, unparseable or shape-less files simply declare nothing.
    expect(providerNamesInFile(`/tmp/opencode/names-missing-${Date.now()}.json`)).toEqual([])
    writeFileSync(p, "not json")
    expect(providerNamesInFile(p)).toEqual([])
    writeFileSync(p, JSON.stringify({ providers: { bad: "nope", ok: { baseUrl: "http://o/v1" } } }))
    expect(providerNamesInFile(p)).toEqual(["ok"])
    rmSync(p, { force: true })
  })
})
