export type Seg = { text: string; bold?: boolean; code?: boolean; header?: 1 | 2 | 3 }

export function parseMarkdown(text: string): Seg[][] {
  const lines = text.split("\n")
  const out: Seg[][] = []
  let inFence = false
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) { inFence = !inFence; continue }
    if (inFence) { out.push([{ text: line, code: true }]); continue }
    out.push(parseInline(line))
  }
  return out
}

function parseInline(line: string): Seg[] {
  const m = /^(#{1,3}) (.+)$/.exec(line)
  if (m) return [{ text: m[2], header: m[1].length as 1 | 2 | 3 }]
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
