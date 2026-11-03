# Persistence

**Append-only store, repaired on read.** Messages are never edited after insert. `cleanHistory` normalizes at request time: unanswered `tool_calls` are stripped from assistant messages, results whose call vanished are dropped. This is what survives aborts and crashes — a stored assistant call without its result row would produce an orphan `tool_calls`/`tool` pair in the wire format and 400 the provider.

## Schema

```sql
session    (id, title, created_at, provider, model, agent, directory, aborted)   -- directory scopes /resume; legacy null rows are excluded; agent holds the resolved id (build for new sessions) and null only for rows created before agents shipped, where the base prompt applies; restored by /resume; provider/model track the LAST model chosen in the session (`store.setModel` on every manual /model switch), so /resume restores the choice, not the creation default
message    (id, session_id, role, content, tool_calls, tool_call_id, meta, created_at)
permission (session_id, tool, resource)   -- "always" grants
```

---

Index: [`docs/architecture.md`](../architecture.md)
