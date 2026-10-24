import { test, expect, afterEach } from "bun:test"
import { errorPage, escapeHtml, redirectUri, startCallbackServer, successPage } from "./callback"

const open: { close(): void }[] = []
afterEach(() => { for (const s of open) s.close(); open.length = 0 })

async function start(state = "s1", timeoutMs = 2000) {
  const s = await startCallbackServer({ state, serverName: "tf", port: 0, timeoutMs })
  s.result.catch(() => {})   // close() in afterEach rejects a flow the test never awaited
  open.push(s)
  return s
}

test("redirectUri: loopback, fixed port, fixed path", () => {
  expect(redirectUri()).toBe("http://127.0.0.1:48762/oauth/callback")
  expect(redirectUri(1234)).toBe("http://127.0.0.1:1234/oauth/callback")
})

test("a matching callback renders the success page and resolves with code + iss", async () => {
  const s = await start("state-a")
  const res = await fetch(`${s.redirectUri}?code=c1&state=state-a&iss=https%3A%2F%2Fas.example`)
  expect(res.status).toBe(200)
  expect(await res.text()).toContain("tf")
  expect(await s.result).toEqual({ code: "c1", iss: "https://as.example" })
})

test("a wrong state is answered 400 and the flow keeps waiting", async () => {
  const s = await start("state-a")
  const bad = await fetch(`${s.redirectUri}?code=c1&state=wrong`)
  expect(bad.status).toBe(400)
  const ok = await fetch(`${s.redirectUri}?code=c2&state=state-a`)
  expect(ok.status).toBe(200)
  expect(await s.result).toEqual({ code: "c2", iss: undefined })
})

test("a second callback after success is refused, and the first code is the one used", async () => {
  const s = await start("state-a")
  await fetch(`${s.redirectUri}?code=c1&state=state-a`)
  const second = await fetch(`${s.redirectUri}?code=c2&state=state-a`).catch(() => undefined)
  expect(second === undefined || second.status === 404).toBe(true)
  expect((await s.result).code).toBe("c1")
})

test("an error response is refused with an escaped page", async () => {
  const s = await start("state-a")
  const res = await fetch(`${s.redirectUri}?state=state-a&error=access_denied&error_description=${encodeURIComponent('<script>alert("x")</script>')}`)
  const html = await res.text()
  expect(html).not.toContain("<script>")
  expect(html).toContain("&lt;script&gt;")
  await expect(s.result).rejects.toThrow(/access_denied/)
})

test("an unknown path is 404 and does not end the flow", async () => {
  const s = await start("state-a")
  const res = await fetch(s.redirectUri.replace("/oauth/callback", "/favicon.ico"))
  expect(res.status).toBe(404)
  await fetch(`${s.redirectUri}?code=c1&state=state-a`)
  expect((await s.result).code).toBe("c1")
})

test("a callback with no code is refused", async () => {
  const s = await start("state-a")
  const res = await fetch(`${s.redirectUri}?state=state-a`)
  expect(res.status).toBe(400)
})

test("the timeout rejects the flow", async () => {
  const s = await start("state-a", 30)
  await expect(s.result).rejects.toThrow(/timed out/)
})

test("close() rejects the pending flow", async () => {
  const s = await start("state-a")
  s.close()
  await expect(s.result).rejects.toThrow(/cancelled/)
})

test("a busy port fails before any browser is opened", async () => {
  const s = await start("state-a")
  const port = Number(new URL(s.redirectUri).port)
  await expect(startCallbackServer({ state: "s2", serverName: "tf", port })).rejects.toThrow(/already in use/)
})

test("escapeHtml covers the five metacharacters", () => {
  expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;")
})

test("both pages are self-contained: no external asset or URL", () => {
  // The pages are served by the loopback listener and the browser may be offline;
  // core is dependency-free, so nothing may be fetched to render them.
  for (const html of [successPage("tf"), errorPage("boom")]) {
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toContain("src=")
    expect(html).not.toContain("@import")
  }
})

test("both pages are mobile-ready and follow the system colour scheme", () => {
  for (const html of [successPage("tf"), errorPage("boom")]) {
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('name="viewport"')
    expect(html).toContain("prefers-color-scheme")
  }
})

test("the success page names the server and tells the user to close the tab", () => {
  const html = successPage("tf")
  expect(html).toContain("tf")
  expect(html).toContain("close this tab")
})

test("the error page shows the escaped message and a next step", () => {
  const html = errorPage('<script>alert("x")</script>')
  expect(html).toContain("&lt;script&gt;")
  expect(html).not.toContain("<script>")
  expect(html).toContain("close this tab")
})
