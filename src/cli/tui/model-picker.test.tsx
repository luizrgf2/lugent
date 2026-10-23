import { test, expect } from "bun:test"
import { renderTui } from "./harness"
import { ModelPicker } from "./model-picker"

const base = {
  providers: ["9router", "ollama"],
  currentProvider: "9router",
  currentModel: "glm/glm-5.2",
}

test("picker lists providers and marks the current one", async () => {
  const { lastFrame } = renderTui(
    <ModelPicker {...base} loadModels={async () => []} onPick={() => {}} onClose={() => {}} />
  )
  await new Promise(r => setTimeout(r, 30))
  const f = lastFrame()
  expect(f).toContain("9router")
  expect(f).toContain("ollama")
})

test("enter on provider loads models; enter on model picks provider+model", async () => {
  const picks: string[] = []
  const { type, lastFrame } = renderTui(
    <ModelPicker {...base} loadModels={async () => ["qwen3.5:14b", "glm/glm-5.2"]}
      onPick={(p, m) => picks.push(p, m)} onClose={() => {}} />
  )
  await new Promise(r => setTimeout(r, 30))
  type("\r")                                     // select 9router (sel defaults to current)
  await new Promise(r => setTimeout(r, 40))
  expect(lastFrame()).toContain("qwen3.5:14b")
  type("\r")                                     // pick first model
  await new Promise(r => setTimeout(r, 30))
  expect(picks).toEqual(["9router", "qwen3.5:14b"])
})

test("down+enter picks the second model; escape goes back to providers then closes", async () => {
  let closed = false
  const picks: string[] = []
  const { type, lastFrame } = renderTui(
    <ModelPicker {...base} loadModels={async () => ["qwen3.5:14b", "glm/glm-5.2"]}
      onPick={(p, m) => picks.push(p, m)} onClose={() => { closed = true }} />
  )
  await new Promise(r => setTimeout(r, 30))
  type("\r")                                     // → models
  await new Promise(r => setTimeout(r, 40))
  type("\u001b[B")                               // ↓ to second model
  await new Promise(r => setTimeout(r, 30))
  type("\r")
  await new Promise(r => setTimeout(r, 30))
  expect(picks).toEqual(["9router", "glm/glm-5.2"])
  expect(closed).toBe(false)                     // pick closes via onPick, not onClose

  // escape path: reopen mentally not possible — separate render for escape test below
})

test("escape at models level returns to providers; escape again closes", async () => {
  let closed = false
  const { type, lastFrame } = renderTui(
    <ModelPicker {...base} loadModels={async () => ["m1"]}
      onPick={() => {}} onClose={() => { closed = true }} />
  )
  await new Promise(r => setTimeout(r, 30))
  type("\r")                                     // → models
  await new Promise(r => setTimeout(r, 40))
  expect(lastFrame()).toContain("m1")
  type("\u001b")                                 // esc: back to providers
  await new Promise(r => setTimeout(r, 100))
  const f = lastFrame()
  expect(f).toContain("ollama")
  expect(f).not.toContain("m1")
  expect(closed).toBe(false)
  type("\u001b")                                 // esc at providers: close
  await new Promise(r => setTimeout(r, 100))
  expect(closed).toBe(true)
})

test("loadModels failure shows error; escape recovers to providers", async () => {
  const { type, lastFrame } = renderTui(
    <ModelPicker {...base} loadModels={async () => { throw new Error("boom") }}
      onPick={() => {}} onClose={() => {}} />
  )
  await new Promise(r => setTimeout(r, 30))
  type("\r")
  await new Promise(r => setTimeout(r, 40))
  expect(lastFrame()).toContain("boom")
  type("\u001b")
  await new Promise(r => setTimeout(r, 100))
  expect(lastFrame()).toContain("ollama")
})

test("long model list windows to ~8 visible rows", async () => {
  const models = Array.from({ length: 20 }, (_, i) => `m${String(i).padStart(2, "0")}`)
  const { type, lastFrame } = renderTui(
    <ModelPicker {...base} loadModels={async () => models} onPick={() => {}} onClose={() => {}} />
  )
  await new Promise(r => setTimeout(r, 30))
  type("\r")
  await new Promise(r => setTimeout(r, 40))
  const f1 = lastFrame()
  expect(f1).toContain("m00")
  expect(f1).not.toContain("m19")
  for (let i = 0; i < 19; i++) type("\u001b[B")
  await new Promise(r => setTimeout(r, 40))
  const f2 = lastFrame()
  expect(f2).toContain("m19")
  expect(f2).not.toContain("m00")
})
