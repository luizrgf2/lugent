export function parseSlash(input: string): { cmd: string; args: string[] } | null {
  if (!input.startsWith("/")) return null
  const [cmd, ...args] = input.slice(1).trim().split(/\s+/)
  return { cmd, args }
}
