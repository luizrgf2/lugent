import { test, expect } from "bun:test"
import { $ } from "bun"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"

test("non-TTY (piped) stdin runs REPL fallback path", async () => {
  const out = await $`printf '/exit\n' | bun src/main.ts --db /tmp/opencode/tui-smoke.db`.quiet().text()
  expect(out).toContain("/model")   // REPL hint line, not TUI frame — pins the isTTY auto-fallback
}, 30000)

test("plain repl: /add-provider without a TTY prints usage instead of prompting", async () => {
  // A non-TTY session has nobody to answer the form's questions, so the command
  // must print a usage line naming its shape and return — not block on
  // rl.question for input that will never come.
  //
  // Two notes on the shape of this test, both measured:
  // - The process is read until the usage line appears and then killed. Bun never
  //   resolves a *second* rl.question once stdin hits EOF, so the REPL loop hangs
  //   after the next prompt on baseline too (`/bogus\n/exit\n` hangs identically
  //   with the feature reverted) — asserting a clean exit would test Bun, not
  //   this command. What matters is that /add-provider answered instead of
  //   prompting.
  // - HOME points at an empty temp dir: otherwise main.ts loads the developer's
  //   real ~/.config/lugent/config.json and health-checks those providers (8s
  //   each) before the REPL starts — a machine-local dependency AGENTS.md forbids
  //   in tests, and the reason an earlier version of this test timed out under
  //   full-suite load.
  const home = mkdtempSync("/tmp/opencode/addprov-home-")
  const script = `${home}/input.txt`
  writeFileSync(script, "/add-provider\n/exit\n")
  const proc = Bun.spawn([process.execPath, "src/main.ts", "--plain", "--db", `${home}/lugent.db`], {
    stdin: Bun.file(script),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: home },
  })
  const reader = proc.stdout.getReader()
  const dec = new TextDecoder()
  let out = ""
  let err = ""
  const errReader = proc.stderr.getReader()
  const deadline = Date.now() + 60000
  const pump = async () => {
    while (Date.now() < deadline && !out.includes("/add-provider <name>")) {
      const chunk: any = await Promise.race([
        reader.read(),
        errReader.read().then((c: any) => ({ stderr: dec.decode(c.value) })),
        new Promise(res => setTimeout(() => res({ timeout: true }), 100)),
      ])
      if (chunk.timeout) continue
      if (chunk.stderr !== undefined) { err += chunk.stderr; continue }
      if (chunk.done) break
      out += dec.decode(chunk.value)
    }
  }
  try {
    await pump()
    expect(err).toBe("")
    expect(out).toContain("/add-provider <name>")   // the usage form, not a hung prompt
    expect(out).not.toContain("unknown command")
  } finally {
    proc.kill()
    rmSync(home, { recursive: true, force: true })
  }
}, 40000)
