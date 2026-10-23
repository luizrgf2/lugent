import { test, expect } from "bun:test"
import { clampItems, type TItem } from "./transcript"

test("clampItems keeps the newest items within line budget", () => {
  const items: TItem[] = Array.from({ length: 60 }, (_, i) => ({ kind: "user" as const, text: `line-${i}` }))
  const out = clampItems(items, 10)
  expect(out).toHaveLength(10)
  expect(out[0].text).toBe("line-50")
  expect(out[9].text).toBe("line-59")
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
