import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"

export interface ProviderConfig { baseUrl: string; apiKey?: string }
export interface AppConfig {
  providers: Record<string, ProviderConfig>
  defaultProvider: string
  defaultModel: string
}

export function subEnv(v: string): string {
  return v.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] ?? "")
}

export function loadConfig(root: string, globalPath = `${homedir()}/.config/lugent/config.json`): AppConfig {
  const paths = [`${root}/lugent.json`, globalPath]
  const file = paths.find(p => existsSync(p))
  if (!file) return { providers: {}, defaultProvider: "", defaultModel: "" }
  const raw = JSON.parse(readFileSync(file, "utf8"))
  const providers: Record<string, ProviderConfig> = {}
  for (const [name, p] of Object.entries(raw.providers ?? {})) {
    const pc = p as ProviderConfig
    providers[name] = { baseUrl: pc.baseUrl, apiKey: pc.apiKey ? subEnv(pc.apiKey) : undefined }
  }
  return {
    providers,
    defaultProvider: raw.defaultProvider ?? "",
    defaultModel: raw.defaultModel ?? "",
  }
}
