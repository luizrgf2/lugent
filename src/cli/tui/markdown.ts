export type Seg = { text: string; bold?: boolean; code?: boolean; header?: 1 | 2 | 3; marker?: boolean; blank?: boolean; sep?: string }

// LRU by insertion order: get = delete+re-set, evict oldest key.
// Streaming reparses the growing prefix per token (O(n²) per answer) — the
// cache collapses it to a Map lookup; old prefixes age out.
const CACHE = new Map<string, Seg[][]>()
const CACHE_MAX = 300

export function parseMarkdown(text: string): Seg[][] {
  const hit = CACHE.get(text)
  if (hit) {
    CACHE.delete(text)
    CACHE.set(text, hit)
    return hit
  }
  const out = compute(text)
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string)
  CACHE.set(text, out)
  return out
}

const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isSep = (l: string) => /^\s*\|(\s*:?-{3,}:?\s*\|)+$/.test(l)
const cells = (l: string) => l.trim().slice(1, -1).split("|").map(c => c.trim())

/** A markdown table: a pipe row followed by a `|---|` separator row. */
function isTable(lines: string[], i: number): boolean {
  return isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])
}

function tableLines(lines: string[], start: number): Seg[][] {
  const body: string[][] = []
  let i = start + 2   // skip header + separator
  while (i < lines.length && isRow(lines[i])) { body.push(cells(lines[i])); i++ }
  const rows = [cells(lines[start]), ...body]
  const width = (c: number) => Math.max(...rows.map(r => r[c]?.length ?? 0))
  // Last column is not padded: ink trims trailing whitespace of the whole line,
  // so end-padding is invisible anyway — interior columns keep the alignment.
  const pad = (t: string, w: number, last: boolean) => last ? t : t + " ".repeat(Math.max(0, w - t.length))
  const gap: Seg = { text: " │ ", sep: "│" }
  return rows.map((r, ri) => {
    const out: Seg[] = []
    r.forEach((c, j) => {
      if (j > 0) out.push(gap)
      const seg = { ...parseInlineFirst(pad(c, width(j), j === r.length - 1)) }
      if (ri === 0 && seg.header === undefined) seg.bold = true
      out.push(seg)
    })
    return out
  })
}

function parseInlineFirst(text: string): Seg {
  return parseInline(text)[0] ?? { text }
}

function compute(text: string): Seg[][] {
  const lines = text.split("\n")
  const out: Seg[][] = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trimStart().startsWith("```")) { inFence = !inFence; continue }
    if (inFence) { out.push([{ text: line, code: true }]); continue }
    if (isTable(lines, i)) { out.push(...tableLines(lines, i)); i += 1 + tableRowCount(lines, i); continue }
    if (line.trim() === "") { if (out.length && out[out.length - 1][0]?.blank) continue; out.push([{ text: "", blank: true }]); continue }
    const m = /^(#{1,3}) (.+)$/.exec(line)
    if (m) { out.push([{ text: m[2], header: m[1].length as 1 | 2 | 3 }]); continue }
    const lm = /^\s*([-*]|\d+\.)\s+(.+)$/.exec(line)
    if (lm) { out.push([{ text: lm[1] === "-" || lm[1] === "*" ? "•" : lm[1], marker: true }, { text: " " + lm[2] }]); continue }
    out.push(parseInline(line))
  }
  return out
}

function tableRowCount(lines: string[], start: number): number {
  let i = start + 2
  while (i < lines.length && isRow(lines[i])) i++
  return i - start - 1
}

function parseInline(line: string): Seg[] {
  const segs: Seg[] = []
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  for (const p of parts) {
    if (!p) continue
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) segs.push({ text: p.slice(1, -1), code: true })
    else if (p.startsWith("**") && p.endsWith("**") && p.length > 4) segs.push({ text: p.slice(2, -2), bold: true })
    else segs.push({ text: p })
  }
  return segs
}
