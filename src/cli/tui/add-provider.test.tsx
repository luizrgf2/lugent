import { test, expect } from "bun:test"
import { AddProvider } from "./add-provider"
import { renderTui } from "./harness"

const base = { existing: [], onSaved: () => {}, onClose: () => {} }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

test("rejects a blank name", async () => {
  const { type, lastFrame } = renderTui(<AddProvider {...base} />)
  type("\r")
  await wait(30)
  expect(lastFrame()).toContain("name is required")
})

test("rejects a name with whitespace", async () => {
  const { type, lastFrame } = renderTui(<AddProvider {...base} />)
  type("my router\r")
  await wait(30)
  expect(lastFrame()).toContain("name cannot contain spaces")
})

test("rejects a name with a slash", async () => {
  const { type, lastFrame } = renderTui(<AddProvider {...base} />)
  type("my/router\r")
  await wait(30)
  expect(lastFrame()).toContain("name cannot contain /")
})

test("a url without a scheme is refused before any test runs", async () => {
  let called = false
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} discover={async () => { called = true; return { ok: true, models: ["a"] } }} />,
  )
  type("r\rr/v1\r")
  await wait(30)
  expect(lastFrame()).toContain("http:// or https://")
  expect(called).toBe(false)
})

test("import stays locked until a test returns models", async () => {
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} discover={() => Promise.resolve({ ok: false, models: [], error: "HTTP 401" })} />,
  )
  type("r\rhttp://r/v1\rsk-1\r")
  await wait(30)
  type("\r")                                  // Test
  await wait(40)
  expect(lastFrame()).toContain("HTTP 401")
  expect(lastFrame()).not.toContain("import")
})

test("a passing test lists the models and saves on confirm", async () => {
  const saved: any[] = []
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} onSaved={(n, c) => saved.push([n, c])} discover={() => Promise.resolve({ ok: true, models: ["a", "b"] })} />,
  )
  type("r\rhttp://r/v1\rsk-1\r")
  await wait(30)
  type("\r")                                  // Test
  await wait(40)
  expect(lastFrame()).toContain("a")
  expect(lastFrame()).toContain("b")
  type("\r")                                  // import & save
  await wait(30)
  expect(saved[0][0]).toBe("r")
  expect(saved[0][1].models).toEqual(["a", "b"])
  expect(saved[0][1].baseUrl).toBe("http://r/v1")
})

test("a failed test can be fixed in place — backspace returns to the key, value intact", async () => {
  const seen: string[] = []
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} discover={async (cfg: any) => { seen.push(cfg.apiKey ?? ""); return { ok: false, models: [], error: "HTTP 401" } }} />,
  )
  type("r\rhttp://r/v1\rsk-wrong\r")
  await wait(30)
  type("\r")                                  // Test → 401
  await wait(40)
  expect(lastFrame()).toContain("HTTP 401")
  type("\u007f")                              // backspace: back to the key field
  await wait(30)
  expect(lastFrame()).toContain("❯ api key:")
  type("x\r")                                 // correct the typo, submit, retest
  await wait(30)
  type("\r")
  await wait(40)
  // Same value plus the correction — nothing was retyped from scratch.
  expect(seen).toEqual(["sk-wrong", "sk-wrongx"])
})

test("a 200 with no models offers a save without a model list", async () => {
  const saved: any[] = []
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} onSaved={(n, c) => saved.push([n, c])}
      discover={async () => ({ ok: false, models: [], noModels: true, error: "endpoint answered but advertised no models" })} />,
  )
  type("r\rhttp://r/v1\rsk-1\r")
  await wait(30)
  type("\r")                                  // Test
  await wait(40)
  expect(lastFrame()).toContain("without a model")
  type("\r")                                  // save it anyway
  await wait(30)
  expect(saved[0][0]).toBe("r")
  expect(saved[0][1]).toEqual({ baseUrl: "http://r/v1", apiKey: "sk-1" })   // no `models` key
})

test("an existing name still confirms before a models-less save", async () => {
  const saved: any[] = []
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} existing={["r"]} onSaved={(n, c) => saved.push([n, c])}
      discover={async () => ({ ok: false, models: [], noModels: true, error: "endpoint answered but advertised no models" })} />,
  )
  type("r\rhttp://r/v1\rsk-1\r")
  await wait(30)
  type("\r")                                  // Test → no models
  await wait(40)
  type("\r")                                  // save without a list
  await wait(30)
  // Same gate as the import path: overwriting is never silent.
  expect(lastFrame()).toContain("overwrite")
  expect(saved.length).toBe(0)
  type("\r")                                  // confirm
  await wait(30)
  expect(saved[0][1]).toEqual({ baseUrl: "http://r/v1", apiKey: "sk-1" })
})

test("the key is never echoed, not even masked reversibly", async () => {
  const { type, lastFrame } = renderTui(<AddProvider {...base} />)
  type("r\rhttp://r/v1\rsk-supersecret-abc\r")
  await wait(30)
  const frame = lastFrame()
  expect(frame).not.toContain("supersecret")
  expect(frame).not.toContain("sk-")
})

test("an existing name asks before overwriting", async () => {
  const saved: any[] = []
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} existing={["r"]} onSaved={(n) => saved.push(n)} discover={() => Promise.resolve({ ok: true, models: ["a"] })} />,
  )
  type("r\rhttp://r/v1\r\r")                  // empty key keeps the stored one
  await wait(30)
  type("\r")                                  // Test
  await wait(40)
  type("\r")                                  // import
  await wait(30)
  expect(lastFrame()).toContain("overwrite")
  expect(saved.length).toBe(0)
  type("\r")                                  // confirm
  await wait(30)
  expect(saved).toEqual(["r"])
})

test("escape closes without saving", async () => {
  let closed = 0
  const { type } = renderTui(<AddProvider {...base} onClose={() => { closed++ }} />)
  type("\x1b")
  await wait(30)
  expect(closed).toBe(1)
})
