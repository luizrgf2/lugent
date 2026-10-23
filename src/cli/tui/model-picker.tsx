import { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"

const MAX_VISIBLE = 8

export function ModelPicker(p: {
  providers: string[]
  currentProvider: string
  currentModel: string
  loadModels(provider: string): Promise<string[]>
  onPick(provider: string, model: string): void
  onClose(): void
}) {
  const [level, setLevel] = useState<"providers" | "models">("providers")
  const [chosen, setChosen] = useState(p.currentProvider)
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState(Math.max(0, p.providers.indexOf(p.currentProvider)))
  // Refs mirror state: ink batches keys into one render; closures must read fresh values.
  const levelRef = useRef(level)
  const selRef = useRef(sel)
  const modelsRef = useRef(models)
  const loadingRef = useRef(loading)
  const errorRef = useRef(error)

  const setSelBoth = (i: number) => { selRef.current = i; setSel(i) }

  async function openModels(prov: string) {
    setChosen(prov)
    levelRef.current = "models"; setLevel("models")
    setSelBoth(0)
    loadingRef.current = true; setLoading(true)
    errorRef.current = null; setError(null)
    try {
      const list = await p.loadModels(prov)
      modelsRef.current = list; setModels(list)
    } catch (e: any) {
      errorRef.current = e.message; setError(e.message)
    } finally {
      loadingRef.current = false; setLoading(false)
    }
  }

  function backToProviders() {
    levelRef.current = "providers"; setLevel("providers")
    setSelBoth(Math.max(0, p.providers.indexOf(chosen)))
  }

  useInput((_input, key) => {
    const list = levelRef.current === "providers" ? p.providers : modelsRef.current
    if (key.upArrow) { setSelBoth(Math.max(0, selRef.current - 1)); return }
    if (key.downArrow) { setSelBoth(Math.min(list.length - 1, selRef.current + 1)); return }
    if (key.return) {
      if (levelRef.current === "providers") { openModels(list[selRef.current]); return }
      if (!loadingRef.current && !errorRef.current && list.length) p.onPick(chosen, list[selRef.current])
      return
    }
    if (key.escape) {
      if (levelRef.current === "models") backToProviders()
      else p.onClose()
      return
    }
    if (key.leftArrow && levelRef.current === "models") { backToProviders(); return }
  })

  const list = level === "providers" ? p.providers : models
  const start = sel < MAX_VISIBLE ? 0 : sel - MAX_VISIBLE + 1
  const view = list.slice(start, start + MAX_VISIBLE)

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text dimColor>/model · {level === "providers" ? "choose provider" : `${chosen} — choose model (← back)`}</Text>
      {level === "providers"
        ? view.map((prov, i) => {
            const idx = start + i
            return (
              <Text key={prov} color={idx === sel ? "cyan" : undefined}>
                {idx === sel ? "❯" : " "} {prov}{prov === p.currentProvider ? " ●" : ""}
              </Text>
            )
          })
        : loading
          ? <Text dimColor>loading models…</Text>
          : error
            ? <Text color="red">failed: {error}</Text>
            : view.length === 0
              ? <Text dimColor>(no models)</Text>
              : view.map((m, i) => {
                  const idx = start + i
                  return (
                    <Text key={m} color={idx === sel ? "cyan" : undefined}>
                      {idx === sel ? "❯" : " "} {m}{m === p.currentModel && chosen === p.currentProvider ? " ●" : ""}
                    </Text>
                  )
                })}
      <Text dimColor>↑/↓ move · enter select · esc {level === "models" ? "back" : "cancel"}</Text>
    </Box>
  )
}
