import { test, expect } from "bun:test"
import { validateArgs } from "./registry"

test("validateArgs: missing required field", () => {
  const err = validateArgs({}, { type: "object", properties: { path: { type: "string" } }, required: ["path"] })
  expect(err).toBe("missing required field: path")
})

test("validateArgs: wrong type", () => {
  const err = validateArgs({ path: 5 }, { type: "object", properties: { path: { type: "string" } }, required: ["path"] })
  expect(err).toBe("field path: expected string, got number")
})

test("validateArgs: null/non-object args", () => {
  expect(validateArgs(null, { type: "object", properties: {} })).toBe("args must be an object")
  expect(validateArgs("x", { type: "object", properties: {} })).toBe("args must be an object")
})

test("validateArgs: valid passes", () => {
  expect(validateArgs({ path: "a" }, { type: "object", properties: { path: { type: "string" } }, required: ["path"] })).toBeNull()
})
