import { describe, test, expect } from "bun:test"
import { subEnv, loadConfig, parseMcpServer, loadMcpConfig } from "./config"
import { rmSync, writeFileSync, mkdirSync } from "node:fs"

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
})
