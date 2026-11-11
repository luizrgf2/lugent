import type { ChatMsg, ChatResponse, ToolCall } from "./types"
import type { ProviderConfig } from "./config"
import { subEnv } from "./config"

export async function* parseSSE(res: Response, idleMs = 120_000, totalMs = 600_000): AsyncGenerator<any> {
  if (!res.body) return
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  const deadline = Date.now() + totalMs
  let buf = ""
  while (true) {
    // Total cap: a proxy or server that drips keep-alive bytes forever defeats
    // the idle guard (every byte resets it) — the turn still has to end.
    if (Date.now() > deadline) {
      reader.cancel().catch(() => {})
      throw new Error(`stream exceeded ${Math.round(totalMs / 1000)}s without finishing (total cap)`)
    }
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

/**
 * Probe an OpenAI-compatible endpoint's `/models` list — the form's Test action.
 *
 * Deliberately separate from `Provider.listModels()`: that one is unbounded and
 * throwing for the turn path, while a form needs a bounded call that reports its
 * failure instead of hanging the overlay or crashing the render. Never throws.
 *
 * `ok` requires a `2xx` *and* at least one parsed model id: gateways that answer
 * `200 {"data":[]}` or an HTML page would otherwise unlock an import that
 * imports nothing. That case is not a dead end, though — it sets `noModels`, and
 * the form offers to save the provider without a `models` key (decision 6).
 */
export async function discoverModels(
  cfg: ProviderConfig,
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ ok: boolean; models: string[]; error?: string; noModels?: boolean }> {
  const base = cfg.baseUrl.replace(/\/+$/, "")
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (cfg.apiKey) {
    // The file keeps `{env:VAR}` literally; only the request resolves it. A
    // reference that resolves to nothing is a config error — say so instead of
    // sending an unauthenticated request and blaming the server's 401.
    const resolved = subEnv(cfg.apiKey)
    if (resolved === "" && cfg.apiKey.includes("{env:")) {
      const name = cfg.apiKey.match(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/)?.[1] ?? cfg.apiKey
      return { ok: false, models: [], error: `environment variable ${name} is not set` }
    }
    headers.authorization = `Bearer ${resolved}`
  }
  let res: Response
  try {
    res = await (opts.fetchFn ?? fetch)(`${base}/models`, {
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    })
  } catch (e) {
    return { ok: false, models: [], error: e instanceof Error ? e.message : String(e) }
  }
  if (!res.ok) {
    res.body?.cancel().catch(() => {})
    return { ok: false, models: [], error: `HTTP ${res.status}` }
  }
  let json: any
  try { json = await res.json() } catch { return { ok: false, models: [], error: "response is not JSON" } }
  const models = (Array.isArray(json?.data) ? json.data : [])
    .map((m: any) => m?.id)
    .filter((id: unknown): id is string => typeof id === "string" && id !== "")
  if (models.length === 0) return { ok: false, models: [], noModels: true, error: "endpoint answered but advertised no models" }
  return { ok: true, models }
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
    /** Total wall-clock cap for one stream, keep-alive bytes included. */
    totalTimeoutMs?: number
    /** Cap on time-to-response-headers (dead host that accepts and never answers). */
    headerTimeoutMs?: number
    /** Retry cap for tests — production retries indefinitely (ESC/abort stops). */
    maxRetries?: number
    /** Backoff base for tests — production starts at 10s and doubles to a 60s cap. */
    backoffBaseMs?: number
    onToken?: (t: string) => void
    onReasoning?: (t: string) => void
    onRetry?: (info: { attempt: number; delayMs: number; error: string }) => void
  }): Promise<ChatResponse> {
    const maxAttempts = (args.maxRetries ?? Infinity) + 1
    let lastErr = new Error("chat failed")
    for (let attempt = 1; ; attempt++) {
      if (attempt > 1) {
        const delayMs = Math.min((args.backoffBaseMs ?? 10_000) * 2 ** (attempt - 2), 60_000)
        args.onRetry?.({ attempt: attempt - 1, delayMs, error: lastErr.message })
        // ponytail: fixed backoff, Retry-After ignored — add when a provider throttles harder than generic backoff handles
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delayMs)
          args.signal?.addEventListener("abort", () => { clearTimeout(t); reject(args.signal!.reason) }, { once: true })
        })
      }
      try {
        // The idle/total guards in parseSSE only start once headers arrive — a host
        // that accepts the connection and never answers would hang the turn forever.
        const ctrl = new AbortController()
        const onAbort = () => ctrl.abort(args.signal?.reason)
        args.signal?.addEventListener("abort", onAbort, { once: true })
        const headerTimer = setTimeout(
          () => ctrl.abort(new Error(`no response within ${args.headerTimeoutMs ?? 15_000}ms (connect/headers timeout)`)),
          args.headerTimeoutMs ?? 15_000,
        )
        let res: Response
        try {
          res = await this.fetchFn(`${this.cfg.baseUrl}/chat/completions`, {
            method: "POST",
            headers: this.headers(),
            signal: ctrl.signal,
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
        } finally {
          clearTimeout(headerTimer)   // headers arrived (or failed) — a long stream must not be killed by it
          args.signal?.removeEventListener("abort", onAbort)
        }
        // retryable: rate limit or server-side problem — the retry loop keeps going
        if (res.status === 429 || res.status >= 500) {
          // never consumed and never retried: drain or the socket leaks per attempt
          res.body?.cancel().catch(() => {})
          throw new Error(`HTTP ${res.status}`)
        }
        if (!res.ok) {
          // client error (bad key, bad request) — retrying forever would be a loop, fail now
          const e: any = new Error(`HTTP ${res.status}: ${await res.text()}`)
          e.fatal = true
          throw e
        }
        // Some gateways return 200 with a JSON error body instead of an SSE stream —
        // parsing that as SSE yields nothing and the turn would end silently empty.
        if ((res.headers.get("content-type") ?? "").includes("json")) {
          const text = await res.text()
          let m = ""
          try { m = JSON.parse(text)?.error?.message ?? "" } catch { /* non-JSON */ }
          throw new Error(m || `non-stream 200 response (${res.headers.get("content-type") ?? "no content-type"})`)
        }
        let content = ""
        const acc: Record<number, { id: string; name: string; args: string }> = {}
        for await (const ev of parseSSE(res, args.idleTimeoutMs ?? 120_000, args.totalTimeoutMs ?? 600_000)) {
          // mid-stream error events otherwise fall through the delta checks and
          // the turn ends "successfully" with no content and nothing displayed
          if (ev.error) throw new Error(typeof ev.error === "string" ? ev.error : ev.error?.message ?? JSON.stringify(ev.error))
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
        if (args.signal?.aborted || e.fatal) throw e
        lastErr = e
      }
      if (attempt >= maxAttempts) throw new Error(`${lastErr.message} (after ${attempt} attempts)`)
    }
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
