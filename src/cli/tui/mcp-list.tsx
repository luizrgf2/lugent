import { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { McpServerState } from "../../core/mcp/manager"
import { mcpActions, formatMcpState, type McpAction } from "../commands"

/** `/mcp`: pick a server, then pick an action. Mirrors the agent/model pickers. */
export function McpList(p: {
  states: McpServerState[]
  onAction(name: string, action: McpAction): Promise<void>
  onClose(): void
}) {
  const [sel, setSel] = useState(0)
  const [open, setOpen] = useState<string | null>(null)   // server whose action menu is open
  const [actionSel, setActionSel] = useState(0)
  const [busy, setBusy] = useState(false)
  // Refs mirror state: ink batches keys into one render (same hazard as input.tsx).
  const selRef = useRef(sel)
  const actionSelRef = useRef(actionSel)
  const setSelBoth = (i: number) => { selRef.current = i; setSel(i) }
  const setActionBoth = (i: number) => { actionSelRef.current = i; setActionSel(i) }

  const row = p.states[selRef.current]
  const actions = row ? mcpActions(row.status) : []

  const run = async (name: string, action: McpAction) => {
    setBusy(true)
    try { await p.onAction(name, action) }
    catch { /* the owner reports the result through `states`; never reject into the void */ }
    finally { setBusy(false); setOpen(null); setActionBoth(0) }
  }

  useInput((_input, key) => {
    if (busy) return
    if (open) {
      if (key.upArrow) { setActionBoth(Math.max(0, actionSelRef.current - 1)); return }
      if (key.downArrow) { setActionBoth(Math.min(actions.length - 1, actionSelRef.current + 1)); return }
      if (key.return) { const a = actions[actionSelRef.current]; if (a) void run(open, a); return }
      if (key.escape) { setOpen(null); setActionBoth(0) }
      return
    }
    if (key.upArrow) { setSelBoth(Math.max(0, selRef.current - 1)); return }
    if (key.downArrow) { setSelBoth(Math.min(p.states.length - 1, selRef.current + 1)); return }
    if (key.return) { if (row && actions.length) setOpen(row.name); return }
    if (key.escape) p.onClose()
  })

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text dimColor>/mcp · servers</Text>
      {p.states.length === 0
        ? <Text dimColor>(no MCP servers — declare one in lugent.json under "mcp")</Text>
        : p.states.map((s, i) => (
            <Text key={s.name} color={i === sel ? "cyan" : undefined}>
              {i === sel ? "❯" : " "} {formatMcpState(s)}{s.status === "connected" ? " ●" : ""}
            </Text>
          ))}
      {open
        ? <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{open} · action</Text>
            {actions.map((a, i) => (
              <Text key={a} color={i === actionSel ? "cyan" : undefined}>{i === actionSel ? "❯" : " "} {a}</Text>
            ))}
          </Box>
        : <Text dimColor>{busy ? "working…" : "↑/↓ move · enter actions · esc cancel"}</Text>}
    </Box>
  )
}
