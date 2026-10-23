import { test, expect } from "bun:test"
import { parseMarkdown } from "./markdown"

test("plain text is one plain segment", () => {
  expect(parseMarkdown("hello world")).toEqual([[{ text: "hello world" }]])
})

test("inline code and bold segments", () => {
  expect(parseMarkdown("a `b` c")).toEqual([
    [{ text: "a " }, { text: "b", code: true }, { text: " c" }],
  ])
  expect(parseMarkdown("x **y** z")).toEqual([
    [{ text: "x " }, { text: "y", bold: true }, { text: " z" }],
  ])
})

test("headers scale 1-3, deeper # is plain", () => {
  expect(parseMarkdown("# T")).toEqual([[{ text: "T", header: 1 }]])
  expect(parseMarkdown("## T")).toEqual([[{ text: "T", header: 2 }]])
  expect(parseMarkdown("### T")).toEqual([[{ text: "T", header: 3 }]])
  expect(parseMarkdown("#### T")).toEqual([[{ text: "#### T" }]])
})

test("fenced block: fence lines vanish, content is code", () => {
  const out = parseMarkdown("before\n```ts\nconst a = 1\n```\nafter")
  expect(out).toEqual([
    [{ text: "before" }],
    [{ text: "const a = 1", code: true }],
    [{ text: "after" }],
  ])
})

test("open fence at end of stream still renders content as code", () => {
  const out = parseMarkdown("```ts\npartial code")
  expect(out).toEqual([[{ text: "partial code", code: true }]])
})

test("multi-line text yields one segment-array per line", () => {
  expect(parseMarkdown("l1\nl2")).toEqual([[{ text: "l1" }], [{ text: "l2" }]])
})
