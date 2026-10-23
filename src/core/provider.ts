import type { ChatMsg, ChatResponse, ToolCall } from "./types"
import type { ProviderConfig } from "./config"

export async function* parseSSE(res: Response, idleMs = 120_000): AsyncGenerator<any> {
  if (!res.body) return
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  while (true) {
    // Idle guard: an upstream that accepts the connection but never sends
    // bytes would hang the turn forever otherwise.
    let timeoutId!: ReturnType<typeof setTimeout>
    const guard = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`stream stalled: no data for ${idleMs}ms`)), idleMs)
    })
    let r: { done: boolean; value?: Uint8Array }
    try {
      r = await Promise.race([reader.read(), guard])
    } catch (e) {
      reader.cancel().catch(() => {})
      throw e
    } finally {
      clearTimeout(timeoutId)
    }
    if (r.done) break
    const value = r.value!
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue
        const payload = line.slice(5).trim()
        if (payload === "[DONE]") return
        try { yield JSON.parse(payload) } catch { /* skip malformed */ }
      }
    }
  }
}

export class Provider {
  constructor(
    private cfg: ProviderConfig,
    private model: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" }
    if (this.cfg.apiKey) h.authorization = `Bearer ${this.cfg.apiKey}`
    return h
  }

  async chat(args: {
    messages: ChatMsg[]
    tools: { name: string; description: string; schema: unknown }[]
    signal?: AbortSignal
    idleTimeoutMs?: number
    onToken?: (t: string) => void
    onReasoning?: (t: string) => void
  }): Promise<ChatResponse> {
    let lastErr = new Error("chat failed")
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 100 * 2 ** attempt))
      try {
        const res = await this.fetchFn(`${this.cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: this.headers(),
          signal: args.signal,
          body: JSON.stringify({
            model: this.model,
            messages: args.messages,
            stream: true,
            tools: args.tools.map(t => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.schema },
            })),
          }),
        })
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status}`)
          continue
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
        let content = ""
        const acc: Record<number, { id: string; name: string; args: string }> = {}
        for await (const ev of parseSSE(res, args.idleTimeoutMs ?? 120_000)) {
          const delta = ev.choices?.[0]?.delta
          if (!delta) continue
          if (typeof delta.content === "string") {
            content += delta.content
            args.onToken?.(delta.content)
          }
          if (typeof (delta as any).reasoning_content === "string") {
            args.onReasoning?.((delta as any).reasoning_content)
          }
          for (const tc of delta.tool_calls ?? []) {
            const slot = acc[tc.index] ??= { id: "", name: "", args: "" }
            if (tc.id) slot.id = tc.id
            if (tc.function?.name) slot.name = tc.function.name
            if (tc.function?.arguments) slot.args += tc.function.arguments
          }
        }
        const toolCalls: ToolCall[] = Object.values(acc)
          .filter(t => t.id)
          .map(t => {
            let parsed: unknown = t.args
            try { parsed = t.args ? JSON.parse(t.args) : {} } catch { /* keep raw string */ }
            return { id: t.id, name: t.name, args: parsed }
          })
        return { content, toolCalls }
      } catch (e: any) {
        if (args.signal?.aborted) throw e
        lastErr = e
      }
    }
    throw lastErr
  }

  async listModels(): Promise<string[]> {
    const res = await this.fetchFn(`${this.cfg.baseUrl}/models`, { headers: this.headers() })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    return (json.data ?? []).map((m: any) => m.id)
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.cfg.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(8000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}
