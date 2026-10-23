import { readFileSync, existsSync, statSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

const MAX_BYTES = 20 * 1024 * 1024   // guardrail: providers cap payloads well below this

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp",
}

/**
 * Expand `@path` image markers in a user message into OpenAI vision parts:
 * string stays a string; markers that resolve to a readable image produce a
 * content-parts array (`[{type:"text"},{type:"image_url"}]`). A marker that
 * doesn't resolve (missing file, non-image, oversized) stays literal text —
 * never silently dropped. ponytail: no clipboard paste / no TUI picker; add
 * when a terminal clipboard story exists.
 */
export function expandImages(text: string, cwd: string): string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] {
  const tokens = [...text.matchAll(/@(\S+)/g)]
  if (tokens.length === 0) return text
  const parts: { type: "text"; text: string }[] | any[] = []
  let textParts: { type: "text"; text: string }[] = []
  let last = 0
  let images = 0
  for (const t of tokens) {
    const path = resolvePath(t[1], cwd)
    const dataUri = readImage(path)
    if (!dataUri) continue   // stays literal, falls through to text slice
    const before = text.slice(last, t.index)
    if (before.trim()) textParts.push({ type: "text", text: before.trim() })
    textParts.push({ type: "image_url", image_url: { url: dataUri } })
    images++
    last = t.index! + t[0].length
  }
  if (images === 0) return text
  const tail = text.slice(last)
  if (tail.trim()) textParts.push({ type: "text", text: tail.trim() })
  return textParts
}

function resolvePath(tok: string, cwd: string): string {
  const p = tok.startsWith("~") ? tok : isAbsolute(tok) ? tok : resolve(cwd, tok)
  return p
}

function readImage(path: string): string | null {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null
    const mime = MIME[path.slice(path.lastIndexOf(".")).toLowerCase()]
    if (!mime) return null
    if (statSync(path).size > MAX_BYTES) return null
    const b64 = readFileSync(path).toString("base64")
    return `data:${mime};base64,${b64}`
  } catch {
    return null
  }
}
