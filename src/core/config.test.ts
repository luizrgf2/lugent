import { describe, test, expect } from "bun:test"
import { subEnv, loadConfig, parseMcpServer, loadMcpConfig, savePermissionMode } from "./config"
import { rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"

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
