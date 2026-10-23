import { test, expect } from "bun:test"
import { parseMarkdown } from "./markdown"

test("parseMarkdown is memoized: same text returns the same reference", () => {
  const t = "# h\nsome `code` and **bold**\n```fence\ninner\n```\ntail"
  expect(parseMarkdown(t)).toBe(parseMarkdown(t))
})

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

test("table block: aligned cells, separator line, header marked", () => {
  const out = parseMarkdown("| a | name |\n| --- | --- |\n| 1 | x |")
  expect(out).toEqual([
    [{ text: "a", bold: true }, { text: " │ ", sep: "│" }, { text: "name", bold: true }],
    [{ text: "1" }, { text: " │ ", sep: "│" }, { text: "x" }],
  ])
})

test("table cells align to the widest cell per column", () => {
  const out = parseMarkdown("| h | x |\n| --- | --- |\n| long cell | y |")
  expect(out[1][0].text).toBe("long cell")
  expect(out[0][0].text).toBe("h        ")
  // last column is never padded (ink trims line-trailing spaces)
  expect(out[0][2].text).toBe("x")
})

test("stray pipe line without separator row stays plain", () => {
  expect(parseMarkdown("| a | b |")).toEqual([[{ text: "| a | b |" }]])
})

test("list items: hyphen and ordered get a marker segment", () => {
  expect(parseMarkdown("- one")).toEqual([[{ text: "•", marker: true }, { text: " one" }]])
  expect(parseMarkdown("2. two")).toEqual([[{ text: "2.", marker: true }, { text: " two" }]])
})

test("two or more blank lines collapse to one", () => {
  expect(parseMarkdown("a\n\n\n\nb").length).toBe(3)
  const f = parseMarkdown("a\n\n\n\nb")
  expect(f[1]).toEqual([{ text: "", blank: true }])
})
