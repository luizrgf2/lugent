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

test("validateArgs: nested/object properties are not type-judged", () => {
  const schema = { type: "object" as const, properties: { filter: { type: "object" } }, required: ["filter"] }
  expect(validateArgs({ filter: { a: 1 } }, schema)).toBeNull()
  expect(validateArgs({ filter: [1, 2] }, schema)).toBeNull()
})

test("validateArgs: required is enforced on a raw schema", () => {
  const schema = { type: "object" as const, properties: { text: { type: "string" } }, required: ["text"] }
  expect(validateArgs({}, schema)).toBe("missing required field: text")
})

test("validateArgs: a schema without properties only checks required", () => {
  expect(validateArgs({ anything: 1 }, { type: "object" as const })).toBeNull()
})
