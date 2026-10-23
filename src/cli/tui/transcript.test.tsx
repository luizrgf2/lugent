import { test, expect } from "bun:test"
import { clampItems, type TItem } from "./transcript"

test("clampItems keeps the newest items within line budget (gaps counted)", () => {
  const items: TItem[] = Array.from({ length: 60 }, (_, i) => ({ kind: "user" as const, text: `line-${i}` }))
  const out = clampItems(items, 10)
  // 5 items = 5 content + 4 gap lines = 9; a 6th would need 11
  expect(out).toHaveLength(5)
  expect(out[0].text).toBe("line-55")
  expect(out[4].text).toBe("line-59")
})

test("clampItems tails a single long multi-line item to the budget", () => {
  const text = Array.from({ length: 60 }, (_, i) => `line-${String(i).padStart(2, "0")}`).join("\n")
  const out = clampItems([{ kind: "assistant", text }], 10)
  expect(out).toHaveLength(1)
  const lines = out[0].text.split("\n")
  expect(lines).toHaveLength(10)
  expect(lines[0]).toBe("line-50")
  expect(lines[9]).toBe("line-59")
})

test("clampItems with budget smaller than everything returns at most the tail of one item", () => {
  const items: TItem[] = [
    { kind: "user", text: "a" },
    { kind: "assistant", text: "l1\nl2\nl3" },
  ]
  const out = clampItems(items, 2)
  expect(out).toHaveLength(1)
  expect(out[0].text).toBe("l2\nl3")
})

test("clampItems skipBottom hides newest lines (scroll up): single-line items", () => {
  const items: TItem[] = Array.from({ length: 30 }, (_, i) => ({ kind: "user" as const, text: `l${i}` }))
  const out = clampItems(items, 5, 10)
  // skipBottom hides l20..l29; budget 5 → 3 items (3 content + 2 gaps)
  expect(out.map(i => i.text)).toEqual(["l17", "l18", "l19"])
})

test("clampItems skipBottom slices the head of a straddling multi-line item", () => {
  const items: TItem[] = [
    { kind: "assistant", text: "l0\nl1\nl2\nl3\nl4" },
    { kind: "user", text: "after" },
  ]
  const out = clampItems(items, 3, 2)   // hide "after" + gap(1) + "l4": show l1..l3
  expect(out).toHaveLength(1)
  expect(out[0].text).toBe("l1\nl2\nl3")
})

test("clampItems skipBottom larger than total content returns empty", () => {
  const items: TItem[] = [{ kind: "user", text: "a" }, { kind: "user", text: "b" }]
  expect(clampItems(items, 5, 10)).toHaveLength(0)
})
