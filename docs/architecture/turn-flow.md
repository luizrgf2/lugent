# Turn flow

```
user input
  → append user message (store)
  → loop (hard cap: 50 tool rounds — past it the turn stops with a
    runaway-guard error and a final user message the next turn answers):
      prefix   = buildPrefix(promptInput)          # byte-stable per agent
      history  = cleanHistory(store.getMessages)   # orphan repair
      messages = buildMessages(prefix, history)    # system + wire format
      tools    = toolsForAgent(allTools, agent)    # agent allowlist minus denied
      res      = provider.chat(messages, tools)    # SSE stream
      if no toolCalls → append assistant text, done
      append assistant message (toolCalls)
      if aborted → flag session, stop (no tool runs)
      run all toolCalls in parallel:
        resolve tool → permission check → validateArgs → execute
        append tool result (truncated at 10k chars)
```

---

Index: [`docs/architecture.md`](../architecture.md)
