import { test, expect } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// A running lugent must never leave an MCP child behind, whatever kills it:
// `process.on("exit")` covers the normal path, SIGTERM/SIGHUP handlers cover
// the signals whose default action skips exit handlers. This drives the real
// entry point, so it is the only test that proves the wiring in `main.ts`.

const repoRoot = join(import.meta.dir, "../../..")
const fixture = join(import.meta.dir, "__fixtures__", "mcp-echo-server.ts")

const isAlive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const until = async (cond: () => boolean, ms: number) => {
  const t0 = Date.now()
  while (!cond() && Date.now() - t0 < ms) await Bun.sleep(50)
  return cond()
}

test("SIGTERM to a running lugent reaps its MCP children", async () => {
  const home = mkdtempSync("/tmp/lugent-sigterm-")
  const pidFile = join(home, "child.pid")
  writeFileSync(join(home, "lugent.json"), JSON.stringify({
    providers: {}, defaultProvider: "", defaultModel: "",
    mcp: { echo: { type: "local", command: ["bun", fixture], environment: { MCP_FIXTURE_PIDFILE: pidFile, MCP_FIXTURE_IGNORE_EOF: "1" }, timeout: 10_000 } },
  }))
  // HOME is redirected so the real ~/.config/lugent/config.json cannot leak in.
  const proc = Bun.spawn(["bun", join(repoRoot, "src/main.ts"), "--plain", "--db", join(home, "db.sqlite")], {
    cwd: home,
    env: { ...process.env, HOME: home, XDG_DATA_HOME: join(home, "data") },
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  })
  try {
    expect(await until(() => existsSync(pidFile), 20_000)).toBe(true)
    const child = parseInt(readFileSync(pidFile, "utf8"), 10)
    expect(isAlive(child)).toBe(true)

    process.kill(proc.pid, "SIGTERM")
    // The exit code alone proves nothing (a default SIGTERM also yields 143);
    // the load-bearing assertion is that the child is really reaped below.
    expect(await proc.exited).toBe(143)
    expect(await until(() => !isAlive(child), 5_000)).toBe(true)
  } finally {
    try { proc.kill("SIGKILL") } catch { /* already gone */ }
    rmSync(home, { recursive: true, force: true })
  }
}, 30_000)
