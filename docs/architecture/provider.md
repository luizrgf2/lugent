# Provider (SSE)

**SSE fragment accumulation.** Streaming `delta.tool_calls` arrive name-first then arguments in arbitrary chunk splits. Provider accumulates by `index` and concatenates `arguments` before parsing. Malformed JSON arguments stay a raw string — the loop's `validateArgs` turns them into a schema-error tool result so the model can retry, instead of crashing the turn. Events are yielded as they arrive (`parseSSE` is an async generator), so `onToken`/`onReasoning` fire during the stream — never buffered until the end.

**Provider.** `stream: true` always; retries up to 3 attempts with exponential backoff; streams are doubly guarded — no bytes for 120s (`idleTimeoutMs`) aborts the read with `stream stalled`, and a total wall-clock cap (default 10min, `totalTimeoutMs`) ends streams that drip keep-alive bytes forever (every byte resets the idle guard, only the total cap catches a proxy that pings without ever finishing); both surface as provider errors instead of forever-hung turns. `429`/`5xx` bodies are cancelled before the retry fires (no socket leak per attempt). `GET /models` doubles as health check. Works with any OpenAI-compatible `/v1` endpoint.

---

Index: [`docs/architecture.md`](../architecture.md)
