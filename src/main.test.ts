import { test, expect } from "bun:test"
import { $ } from "bun"

test("non-TTY (piped) stdin runs REPL fallback path", async () => {
  const out = await $`printf '/exit\n' | bun src/main.ts --db /tmp/opencode/tui-smoke.db --plain`.quiet().text()
  expect(out).toContain("/model")   // REPL hint line, not TUI frame
}, 30000)
