import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { SkillMeta } from "./types"

export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { data: {}, body: text }
  const end = text.indexOf("\n---", 3)
  if (end === -1) return { data: {}, body: text }
  const head = text.slice(4, end)             // skip leading "---\n"
  const body = text.slice(end + 4)            // skip trailing "\n---"
  const data: Record<string, string> = {}
  for (const line of head.split("\n")) {
    const i = line.indexOf(":")
    if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { data, body }
}

export function loadSkills(projectRoot: string): SkillMeta[] {
  const dir = join(projectRoot, ".agents", "skills")
  if (!existsSync(dir)) return []
  const out: SkillMeta[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const file = join(dir, entry.name, "SKILL.md")
      if (!existsSync(file)) continue
      const { data } = parseFrontmatter(readFileSync(file, "utf8"))
      if (!data.description) continue
      out.push({ id: entry.name, name: data.name ?? entry.name, description: data.description, file })
    } else if (entry.name.endsWith(".md")) {
      const file = join(dir, entry.name)
      const { data } = parseFrontmatter(readFileSync(file, "utf8"))
      if (!data.description) continue
      const id = entry.name.replace(/\.md$/, "")
      out.push({ id, name: data.name ?? id, description: data.description, file })
    }
  }
  return out
}

export function readSkillBody(meta: SkillMeta): string {
  return parseFrontmatter(readFileSync(meta.file, "utf8")).body
}
