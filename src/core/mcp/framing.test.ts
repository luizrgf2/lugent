import { test, expect } from "bun:test"
import { LineBuffer } from "./framing"
import { isResponse, isRequest, isNotification } from "./protocol"

test("LineBuffer: a partial line is buffered until its newline arrives", () => {
  const b = new LineBuffer()
  expect(b.push('{"jsonrpc":"2.0","id":1,"resu')).toEqual([])
  expect(b.push('lt":{"ok":true}}\n')).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: true } }])
})

test("LineBuffer: several messages in one chunk", () => {
  const b = new LineBuffer()
  const out = b.push('{"a":1}\n\n{"b":2}\r\n')
  expect(out).toEqual([{ a: 1 }, { b: 2 }])
})

test("LineBuffer: malformed line is skipped, the rest still parses", () => {
  const b = new LineBuffer()
  expect(b.push('not json\n{"ok":1}\n')).toEqual([{ ok: 1 }])
})

test("message guards", () => {
  expect(isResponse({ jsonrpc: "2.0", id: 1, result: {} })).toBe(true)
  expect(isResponse({ jsonrpc: "2.0", id: 1, method: "x" })).toBe(false)
  expect(isRequest({ jsonrpc: "2.0", id: 1, method: "x" })).toBe(true)
  expect(isNotification({ jsonrpc: "2.0", method: "x" })).toBe(true)
  expect(isNotification({ jsonrpc: "2.0", id: 1, method: "x" })).toBe(false)
})
