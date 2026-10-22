export function unifiedDiff(path: string, oldText: string, newText: string): string {
  // ponytail: block diff (removed vs added), not line-aligned LCS — good enough
  // for permission review; swap for a real diff lib when edits get wide.
  const oldLines = oldText.split("\n").map(l => `-${l}`)
  const newLines = newText.split("\n").map(l => `+${l}`)
  return [`--- ${path}`, "+++ (edited)", ...oldLines, ...newLines].join("\n")
}
