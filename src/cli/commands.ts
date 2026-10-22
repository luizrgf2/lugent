export function parseSlash(input: string): { cmd: string; args: string[] } | null {
  if (!input.startsWith("/")) return null
  const [cmd, ...args] = input.slice(1).trim().split(/\s+/)
  return { cmd, args }
}

/** Permission prompt answer: only explicit y/a allows — everything else denies (F3). */
export function parseAnswer(answer: string): "y" | "n" | "a" {
  const c = answer.trim().toLowerCase()
  if (c === "a" || c === "always") return "a"
  if (c === "y" || c === "yes") return "y"
  return "n"
}
