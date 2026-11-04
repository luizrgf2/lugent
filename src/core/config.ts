import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { homedir } from "node:os"
import { parseModelRef } from "./agents"
import type { AgentModelRef } from "./types"

export interface ProviderConfig { baseUrl: string; apiKey?: string }
export type PermissionMode = "normal" | "yolo"
export interface AppConfig {
  providers: Record<string, ProviderConfig>
  defaultProvider: string
  defaultModel: string
  defaultAgent?: string
  /** Model a subagent without its own `model` runs on ("provider/model"). */
  defaultSubagentModel?: AgentModelRef
  permissionMode: PermissionMode
}

export interface McpCommon { enabled?: boolean; timeout?: number }
export interface McpLocal extends McpCommon { type: "local"; command: string[]; environment?: Record<string, string>; cwd?: string }
export interface McpRemote extends McpCommon { type: "remote" | "http"; url: string; headers?: Record<string, string>; scopes?: string[] }
export type McpServerConfig = McpLocal | McpRemote
export type McpServerConfigMap = Record<string, McpServerConfig>

export function subEnv(v: string): string {
  return v.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] ?? "")
}

export function loadConfig(root: string, globalPath = `${homedir()}/.config/lugent/config.json`): AppConfig {
  const paths = [`${root}/lugent.json`, globalPath]
  const file = paths.find(p => existsSync(p))
  if (!file) return { providers: {}, defaultProvider: "", defaultModel: "", permissionMode: "normal" }
  const raw = JSON.parse(readFileSync(file, "utf8"))
  const providers: Record<string, ProviderConfig> = {}
  for (const [name, p] of Object.entries(raw.providers ?? {})) {
    const pc = p as ProviderConfig
    providers[name] = { baseUrl: pc.baseUrl, apiKey: pc.apiKey ? subEnv(pc.apiKey) : undefined }
  }
  let defaultSubagentModel: AgentModelRef | undefined
  if (raw.defaultSubagentModel !== undefined) {
    defaultSubagentModel = parseModelRef(String(raw.defaultSubagentModel))
    if (!defaultSubagentModel)
      console.warn(`defaultSubagentModel: expected "provider/model", got ${JSON.stringify(raw.defaultSubagentModel)} — subagents inherit the session model`)
  }
  let permissionMode: PermissionMode = "normal"
  if (raw.permissionMode !== undefined) {
    if (raw.permissionMode === "normal" || raw.permissionMode === "yolo") permissionMode = raw.permissionMode
    else console.warn(`permissionMode: expected "normal" or "yolo", got ${JSON.stringify(raw.permissionMode)} — using "normal"`)
  }
  return {
    providers,
    defaultProvider: raw.defaultProvider ?? "",
    defaultModel: raw.defaultModel ?? "",
    defaultAgent: raw.defaultAgent,
    defaultSubagentModel,
    permissionMode,
  }
}

export const globalConfigPath = (): string => `${homedir()}/.config/lugent/config.json`

/**
 * Persist the user's permission-mode choice to the global config (never the
 * project file — a repo must not decide trust level). Existing keys survive;
 * an unparseable file is replaced. The mode still loads from the first file
 * found, so a project `permissionMode` keeps overriding the saved choice.
 * Returns whether the choice was persisted — a failed write (e.g. a read-only
 * `~/.config/lugent`) only warns; the caller keeps the session-only mode.
 */
export function savePermissionMode(mode: PermissionMode, path = globalConfigPath()): boolean {
  let raw: Record<string, unknown> = {}
  try { raw = JSON.parse(readFileSync(path, "utf8")) } catch {}
  raw.permissionMode = mode
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(raw, null, 2) + "\n")
  } catch (e) {
    console.warn(`permission mode: could not save to ${path} (${e instanceof Error ? e.message : e}) — session only`)
    return false
  }
  return true
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
    // Optional: without it the flow sends no scope at all and the consent screen decides.
    if (r.scopes !== undefined) {
      const list = Array.isArray(r.scopes) ? r.scopes : []
      const scopes = list.filter((s: unknown): s is string => typeof s === "string" && s !== "")
      if (scopes.length && scopes.length === list.length) cfg.scopes = scopes
      else console.warn(`mcp ${name}: "scopes" must be a non-empty array of strings, ignored`)
    }
    return cfg
  }
  console.warn(`mcp ${name}: unknown type ${JSON.stringify(rawType)}, dropped`)
  return undefined
}

/**
 * The `mcp` map merges across both config files (global first, project wins) —
 * unlike `providers`, which is first-file-wins. A project entry replaces the
 * whole global entry; disabling a server means repeating it with
 * `enabled: false` — either the whole entry, or just `{ "enabled": false }` as a
 * marker. Markers are collected from both files and applied last, so they win
 * wherever the server was declared (the global file can therefore switch off a
 * server that only a repo declares). The entry stays either way, listed as
 * `disabled` by `/mcp` so it can be re-enabled for the session.
 */
export function loadMcpConfig(root: string, globalPath = `${homedir()}/.config/lugent/config.json`): McpServerConfigMap {
  const merged: McpServerConfigMap = {}
  const markers: string[] = []
  for (const file of [globalPath, `${root}/lugent.json`]) {
    if (!existsSync(file)) continue
    let raw: any
    try { raw = JSON.parse(readFileSync(file, "utf8")) } catch { console.warn(`mcp: invalid JSON in ${file}, skipped`); continue }
    for (const [name, entry] of Object.entries(raw.mcp ?? {})) {
      if (isDisableMarker(entry)) { markers.push(name); continue }
      const cfg = parseMcpServer(name, entry)
      if (cfg) merged[name] = cfg
    }
  }
  for (const name of markers) {
    const prev = merged[name]
    if (prev) merged[name] = { ...prev, enabled: false }
    else console.warn(`mcp ${name}: "enabled: false" marker for a server declared nowhere, dropped`)
  }
  return merged
}

/** `{ "enabled": false }` with nothing else: a marker for a server declared elsewhere. */
function isDisableMarker(entry: unknown): boolean {
  const r = entry as Record<string, unknown> | null
  return typeof r === "object" && r !== null && r.enabled === false
    && typeof r.type !== "string" && typeof r.url !== "string" && !Array.isArray(r.command)
}
