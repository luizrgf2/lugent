import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"

export interface ProviderConfig { baseUrl: string; apiKey?: string }
export interface AppConfig {
  providers: Record<string, ProviderConfig>
  defaultProvider: string
  defaultModel: string
  defaultAgent?: string
}

export interface McpCommon { enabled?: boolean; timeout?: number }
export interface McpLocal extends McpCommon { type: "local"; command: string[]; environment?: Record<string, string>; cwd?: string }
export interface McpRemote extends McpCommon { type: "remote" | "http"; url: string; headers?: Record<string, string> }
export type McpServerConfig = McpLocal | McpRemote
export type McpServerConfigMap = Record<string, McpServerConfig>

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
    defaultAgent: raw.defaultAgent,
  }
}

function subEnvMap(m: unknown): Record<string, string> | undefined {
  if (typeof m !== "object" || m === null) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) if (typeof v === "string") out[k] = subEnv(v)
  return out
}

/** One raw `mcp` entry → a validated config; bad entries warn and return undefined. */
export function parseMcpServer(name: string, raw: unknown): McpServerConfig | undefined {
  if (typeof raw !== "object" || raw === null) { console.warn(`mcp ${name}: entry must be an object, dropped`); return undefined }
  const r = raw as Record<string, any>
  const common: McpCommon = {}
  if (r.enabled === false) common.enabled = false
  if (typeof r.timeout === "number" && r.timeout > 0) common.timeout = r.timeout

  const rawType = r.type
  const type: string | undefined = typeof rawType === "string"
    ? rawType
    : typeof r.url === "string" ? "remote" : Array.isArray(r.command) ? "local" : undefined
  if (type === undefined) { console.warn(`mcp ${name}: needs "url" (remote) or "command" (local), dropped`); return undefined }

  if (type === "local") {
    const command = Array.isArray(r.command) ? r.command.filter((c: unknown): c is string => typeof c === "string" && c !== "") : []
    if (command.length === 0) { console.warn(`mcp ${name}: local server needs a non-empty "command" array, dropped`); return undefined }
    const cfg: McpLocal = { type: "local", command, ...common }
    const environment = subEnvMap(r.environment)
    if (environment) cfg.environment = environment
    if (typeof r.cwd === "string" && r.cwd) cfg.cwd = r.cwd
    return cfg
  }
  if (type === "remote" || type === "http") {
    if (typeof r.url !== "string" || !/^https?:\/\//.test(r.url)) { console.warn(`mcp ${name}: remote server needs an http(s) "url", dropped`); return undefined }
    const cfg: McpRemote = { type, url: r.url, ...common }
    const headers = subEnvMap(r.headers)
    if (headers) cfg.headers = headers
    return cfg
  }
  console.warn(`mcp ${name}: unknown type ${JSON.stringify(rawType)}, dropped`)
  return undefined
}

/**
 * The `mcp` map merges across both config files (global first, project wins) —
 * unlike `providers`, which is first-file-wins. A project entry replaces the
 * whole global entry; disabling a global server means repeating it with
 * `enabled: false` (the entry stays, listed as disabled by `/mcp`).
 */
export function loadMcpConfig(root: string, globalPath = `${homedir()}/.config/lugent/config.json`): McpServerConfigMap {
  const merged: McpServerConfigMap = {}
  for (const file of [globalPath, `${root}/lugent.json`]) {
    if (!existsSync(file)) continue
    let raw: any
    try { raw = JSON.parse(readFileSync(file, "utf8")) } catch { console.warn(`mcp: invalid JSON in ${file}, skipped`); continue }
    for (const [name, entry] of Object.entries(raw.mcp ?? {})) {
      const cfg = parseMcpServer(name, entry)
      if (cfg) merged[name] = cfg
    }
  }
  return merged
}
