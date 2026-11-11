import { test, expect } from "bun:test"
import { $ } from "bun"

test("non-TTY (piped) stdin runs REPL fallback path", async () => {
  const out = await $`printf '/exit\n' | bun src/main.ts --db /tmp/opencode/tui-smoke.db`.quiet().text()
  expect(out).toContain("/model")   // REPL hint line, not TUI frame — pins the isTTY auto-fallback
}, 30000)

test("plain repl: /add-provider without a TTY prints usage instead of prompting", async () => {
  // Piped stdin: the command must answer with a usage line instead of blocking on
  // form questions nobody can answer. Bun never resolves a *second* rl.question
  // once stdin hits EOF, so this reads until the line appears and then kills the
  // process — the assertion is on what the command printed, not a clean exit.
  const db = `/tmp/opencode/addprov-${Date.now()}.db`
  const proc = Bun.spawn(["bun", "src/main.ts", "--plain", "--db", db], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  proc.stdin.write("/add-provider\n")
  await proc.stdin.flush()
  const reader = proc.stdout.getReader()
  const dec = new TextDecoder()
  let out = ""
  const deadline = Date.now() + 15000
  while (Date.now() < deadline && !out.includes("/add-provider <name>")) {
    const chunk: any = await Promise.race([
      reader.read(),
      new Promise(res => setTimeout(() => res({ timeout: true }), 100)),
    ])
    if (chunk.timeout) continue
    if (chunk.done) break
    out += dec.decode(chunk.value)
  }
  proc.kill()
  expect(out).toContain("/add-provider <name>")
}, 30000)
