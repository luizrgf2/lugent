import type { ProviderConfig } from "../core/config"
import { providerNamesInFile } from "../core/config"
import type { discoverModels } from "../core/provider"

type Cfg = { baseUrl: string; apiKey?: string; models?: string[] }

export type AddProviderResult =
  /** The entry was written (or would have been, had the file allowed it). */
  | { status: "saved"; name: string; imported: number; kept: number; live: ProviderConfig; saveOk: boolean; saveError?: string }
  | { status: "cancelled" }
  | { status: "invalid"; error: string }

/** Same rules the TUI form applies — the name becomes a JSON key and a picker row. */
export function validateName(raw: string): string | null {
  const n = raw.trim()
  if (!n) return "name is required"
  if (/\s/.test(raw)) return "name cannot contain spaces"
  if (n.includes("/")) return "name cannot contain /"
  return null
}

export function validateUrl(raw: string): string | null {
  return /^https?:\/\/.+/.test(raw.trim()) ? null : "base url must start with http:// or https://"
}

/** `/v1` missing is legal (a gateway may serve `/models` elsewhere) — warn only. */
export function needsV1(raw: string): boolean {
  return !/\/v\d+\/?$/.test(raw.trim())
}

/**
 * Names the save would overwrite: the live config's plus whatever the global file
 * already holds.
 *
 * The union is not belt-and-braces — `loadConfig` is first-file-wins, so in a repo
 * whose `lugent.json` declares providers every global entry is invisible to
 * `env.config.providers`. Those hidden entries are precisely the ones a save to
 * the global file would replace, so a gate built from the live map alone would
 * ask about the wrong set of names.
 */
export function existingProviderNames(live: string[], globalPath: string): string[] {
  return [...new Set([...live, ...providerNamesInFile(globalPath)])]
}

/**
 * The `/add-provider` flow, free of readline and of `console`, so both the plain
 * REPL (which asks through `readline`) and a test (which scripts the answers) run
 * the exact same validation and confirmation logic.
 *
 * The overwrite gate is the point of the split: the command replaces a whole
 * `providers.<name>` entry, so a name that already exists must be confirmed with
 * a **`[y/N]`** — a bare `enter` is a no. That is the one prompt in this flow
 * whose default is not the destructive branch.
 */
export async function runAddProviderForm(opts: {
  /** The name from `/add-provider <name>`; asked for when absent. */
  name?: string
  ask: (prompt: string) => Promise<string>
  say?: (line: string) => void
  /** Fires once, right before the network call — the REPL prints a dim "testing…" line there. */
  onTest?: (normalizedUrl: string) => void
  discover: typeof discoverModels
  /** Names already in the live config — collision means "this overwrites". */
  existing: string[]
  save: (name: string, cfg: Cfg) => { ok: boolean; error?: string; live: ProviderConfig }
}): Promise<AddProviderResult> {
  const say = opts.say ?? (() => {})

  const name = (opts.name ?? (await opts.ask("name: "))).trim()
  const nameError = validateName(name)
  if (nameError) return { status: "invalid", error: nameError }

  const baseUrl = (await opts.ask("base url: ")).trim()
  const urlError = validateUrl(baseUrl)
  if (urlError) return { status: "invalid", error: urlError }
  if (needsV1(baseUrl)) say("! no /v1 in the base url — most OpenAI-compatible endpoints need it")

  // Blank keeps whatever the global config already holds for this name.
  const apiKey = (await opts.ask("api key (blank keeps the stored one): ")).trim()

  opts.onTest?.(baseUrl.replace(/\/+$/, ""))
  const found = await opts.discover({ baseUrl, apiKey })
  let models: string[] | undefined
  if (found.ok) {
    found.models.forEach((m, i) => say(`  ${i + 1}. ${m}`))
    const yes = await opts.ask(`import these ${found.models.length} models? [Y/n] `)
    if (yes.trim().toLowerCase() === "n") return { status: "cancelled" }
    models = found.models
  } else if (found.noModels) {
    // A reachable endpoint that advertises nothing: the provider is usable, it
    // just has no cached list (`/model` falls back to a live call).
    const yes = await opts.ask(`test ok but the endpoint lists no models — save ${name} anyway? [Y/n] `)
    if (yes.trim().toLowerCase() === "n") return { status: "cancelled" }
  } else {
    return { status: "invalid", error: `test failed: ${found.error}` }
  }

  // Collision gate. Says both consequences: what is replaced (base url and key)
  // and what happens to the cached list — `saveProvider` KEEPS it when this run
  // imported nothing, and a prompt that did not say so would be a lie.
  if (opts.existing.includes(name)) {
    const what = models
      ? "its base url and model list will be replaced"
      : "its base url will be replaced and it keeps its current model list"
    const answer = await opts.ask(
      `overwrite ${name}? ${what} (an empty key field keeps the current key) [y/N] `,
    )
    if (answer.trim().toLowerCase() !== "y" && answer.trim().toLowerCase() !== "yes") return { status: "cancelled" }
  }

  const cfg: Cfg = { baseUrl }
  if (apiKey) cfg.apiKey = apiKey
  if (models) cfg.models = models
  const saved = opts.save(name, cfg)
  return {
    status: "saved",
    name,
    imported: models?.length ?? 0,
    kept: saved.live.models?.length ?? 0,
    live: saved.live,
    saveOk: saved.ok,
    saveError: saved.error,
  }
}
