import { test, expect } from "bun:test"
import { itemsFromHistory } from "./transcript"
import type { Message } from "../../core/types"

const mk = (over: Partial<Message> & { role: Message["role"] }): Message => ({
  id: "m", sessionId: "s", content: null, createdAt: "2026-01-01T00:00:00Z", ...over,
})

test("maps stored history to transcript items", () => {
  const msgs = [
    mk({ role: "user", content: "read main.ts" }),
    mk({ role: "assistant", content: null, toolCalls: [{ id: "t1", name: "read", args: { path: "main.ts" } }] }),
    mk({ role: "tool", toolCallId: "t1", content: "1: hi" }),
    mk({ role: "assistant", content: "done" }),
  ]
  expect(itemsFromHistory(msgs)).toEqual([
    { kind: "user", text: "read main.ts" },
    { kind: "tool", tool: "read", text: "main.ts" },
    { kind: "assistant", text: "done" },
  ])
})

test("unknown tool results degrade gracefully", () => {
  expect(itemsFromHistory([mk({ role: "tool", toolCallId: "gone", content: "x" })]))
    .toEqual([{ kind: "tool", tool: "?", text: "" }])
})

test("non-string arg falls back to JSON of the args", () => {
  const msgs = [
    mk({ role: "assistant", content: null, toolCalls: [{ id: "t1", name: "shell", args: { command: ["ls"] } }] }),
    mk({ role: "tool", toolCallId: "t1", content: "out" }),
  ]
  expect(itemsFromHistory(msgs)[0]).toEqual({ kind: "tool", tool: "shell", text: '{"command":["ls"]}' })
})
