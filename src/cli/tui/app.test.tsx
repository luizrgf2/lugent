import { test, expect } from "bun:test"
import { render } from "ink-testing-library"
import { App } from "./app"

export function fakeEnv(over: Record<string, unknown> = {}): any {
  return {
    config: { defaultProvider: "9router", defaultModel: "glm/glm-5.2", providers: {} },
    tools: [],
    skills: [],
    projectRoot: "/tmp/opencode",
    offProviders: [],
    ...over,
  }
}

test("app skeleton renders header and empty transcript", () => {
  const { lastFrame } = render(<App env={fakeEnv()} />)
  expect(lastFrame()).toContain("lugent")
  expect(lastFrame()).toContain("9router · glm/glm-5.2")
})
