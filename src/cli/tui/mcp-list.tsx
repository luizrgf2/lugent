import { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { McpServerState } from "../../core/mcp/manager"
import { mcpActions, formatMcpState, type McpAction } from "../commands"

/** `/mcp`: pick a server, then pick an action. Mirrors the agent/model pickers. */
export function McpList(p: {
  states: McpServerState[]
  onAction(name: string, action: McpAction, onUrl: (url: string) => void): Promise<void>
  onClose(): void
}) {
  const [sel, setSel] = useState(0)
  const [open, setOpen] = useState<string | null>(null)   // server whose action menu is open
  const [actionSel, setActionSel] = useState(0)
  const [busy, setBusy] = useState(false)
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  // Refs mirror state: ink batches keys into one render (same hazard as input.tsx).
  const selRef = useRef(sel)
  const actionSelRef = useRef(actionSel)
  const setSelBoth = (i: number) => { selRef.current = i; setSel(i) }
  const setActionBoth = (i: number) => { actionSelRef.current = i; setActionSel(i) }

  const row = p.states[selRef.current]
  const actions = row ? mcpActions(row.status, row.type) : []

  const run = async (name: string, action: McpAction) => {
    setBusy(true)
    try { await p.onAction(name, action, setPendingUrl) }
    catch { /* the owner reports the result through `states`; never reject into the void */ }
    finally { setBusy(false); setOpen(null); setActionBoth(0); setPendingUrl(null) }
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

  // The consent URL is rendered outside the bordered box: inside it, ink wraps the
  // long URL at the box width and draws `│` on every visual line, so copying the
  // wrapped text yields border characters and hard line breaks. Outside the border,
  // with a width the URL always fits, it is emitted as one logical line and the
  // terminal soft-wraps it (copy joins soft wraps).
  const showUrl = busy && pendingUrl !== null
  return (
    <Box flexDirection="column" alignItems="flex-start">
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} width="100%">
        <Text dimColor>/mcp · servers</Text>
        {p.states.length === 0
          ? <Text dimColor>(no MCP servers — declare one in lugent.json under "mcp")</Text>
          : p.states.map((s, i) => (
              <Text key={s.name} color={i === sel ? "cyan" : undefined}>
                {i === sel ? "❯" : " "} {formatMcpState(s)}{s.status === "connected" ? " ●" : ""}
              </Text>
            ))}
        {showUrl
          ? <Box flexDirection="column" marginTop={1}>
              <Text dimColor>waiting for authorization… (ctrl+c cancels)</Text>
              <Text dimColor>browser did not open? copy the link below</Text>
            </Box>
          : open
            ? <Box flexDirection="column" marginTop={1}>
                <Text dimColor>{open} · action</Text>
                {actions.map((a, i) => (
                  <Text key={a} color={i === actionSel ? "cyan" : undefined}>{i === actionSel ? "❯" : " "} {a}</Text>
                ))}
              </Box>
            : <Text dimColor>{busy ? "working…" : "↑/↓ move · enter actions · esc cancel"}</Text>}
      </Box>
      {showUrl
        ? <Box width={100000} flexShrink={0} marginTop={1}>
            <Text wrap="truncate">{pendingUrl}</Text>
          </Box>
        : undefined}
    </Box>
  )
}
