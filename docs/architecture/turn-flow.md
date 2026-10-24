# Turn flow

```
user input
  → append user message (store)
  → loop:
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
