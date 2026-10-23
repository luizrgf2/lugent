import { describe, test, expect } from "bun:test"
import { subEnv, loadConfig } from "./config"
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
})
