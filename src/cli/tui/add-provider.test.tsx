import { test, expect } from "bun:test"
import { AddProvider } from "./add-provider"
import { renderTui } from "./harness"
import { discoverModels } from "../../core/provider"

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

test("a wrong url can be fixed without retyping the form — ← walks back from the key", async () => {
  const seen: string[] = []
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} discover={async (cfg: any) => {
      seen.push(cfg.baseUrl)
      // First probe refuses the connection; the corrected one answers.
      return seen.length === 1
        ? { ok: false, models: [], error: "connect ECONNREFUSED" }
        : { ok: true, models: ["m1"] }
    }} />,
  )
  type("r\rhttp://localhost:999/v1\rsk-1\r")
  await wait(30)
  type("\r")                                  // Test → refused
  await wait(40)
  expect(lastFrame()).toContain("ECONNREFUSED")
  type("\u007f")                              // backspace: back to the key field
  await wait(30)
  expect(lastFrame()).toContain("❯ api key:")
  type("\u001b[D")                            // ← walks back to the url, key intact
  await wait(30)
  expect(lastFrame()).toContain("❯ base url:")
  expect(lastFrame()).toContain("http://localhost:999/v1")
  type("\u007f".repeat(6))                    // drop "999/v1"
  type("8123/v1\r")                           // correct the port
  await wait(30)
  type("\r")                                  // key is still there → test
  await wait(30)
  type("\r")                                  // retest
  await wait(40)
  // The second probe got the corrected url — nothing was retyped from scratch.
  expect(seen).toEqual(["http://localhost:999/v1", "http://localhost:8123/v1"])
})

test("an empty field's backspace also walks back — key → url with no key typed", async () => {
  const seen: string[] = []
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} discover={async (cfg: any) => {
      seen.push(cfg.baseUrl)
      return seen.length === 1
        ? { ok: false, models: [], error: "connect ECONNREFUSED" }
        : { ok: true, models: ["m1"] }
    }} />,
  )
  type("r\rhttp://localhost:999/v1\r\r")      // empty key is legal
  await wait(30)
  type("\r")                                  // Test → refused
  await wait(40)
  type("\u007f")                              // ⌫ from test → key (empty)
  await wait(30)
  expect(lastFrame()).toContain("❯ api key:")
  type("\u007f")                              // ⌫ on the empty key → url
  await wait(30)
  expect(lastFrame()).toContain("❯ base url:")
  type("\u007f".repeat(6))                    // drop "999/v1"
  type("8123/v1\r")                           // corrected port; url submits → key
  await wait(30)
  type("\r")                                  // key submits (still empty) → test
  await wait(30)
  type("\r")                                  // test with the corrected url
  await wait(40)
  expect(seen.length).toBe(2)
  expect(seen[1]).toBe("http://localhost:8123/v1")
})

test("a models-less overwrite says the cached list is kept, not dropped", async () => {
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} existing={["r"]} onSaved={() => {}}
      discover={async () => ({ ok: false, models: [], noModels: true, error: "endpoint answered but advertised no models" })} />,
  )
  type("r\rhttp://r/v1\rsk-1\r")
  await wait(30)
  type("\r")                                  // Test → no models
  await wait(40)
  type("\r")                                  // save without a list → confirm
  await wait(30)
  // `saveProvider` keeps the previous list; the confirm must not claim otherwise.
  expect(lastFrame()).toContain("keeps its current model list")
  expect(lastFrame()).not.toContain("keeps no model list")
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

test("an unparsable 200 body reaches the models-less offer, not a retest dead end", async () => {
  // Spec decision 6 names non-JSON bodies explicitly. A gateway behind a login
  // page answers 200 text/html — that is a reachable provider, so the form must
  // offer the models-less save instead of printing "response is not JSON" and
  // telling the user to retest a url that just answered.
  const saved: any[] = []
  const htmlDiscover: typeof discoverModels = (cfg, opts = {}) =>
    discoverModels(cfg, { ...opts, fetchFn: (async () => new Response("<html>login</html>", { status: 200 })) as any })
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} onSaved={(n, c) => saved.push([n, c])} discover={htmlDiscover} />,
  )
  type("r\rhttp://r/v1\rsk-1\r")
  await wait(30)
  type("\r")                                  // Test → 200 HTML
  await wait(40)
  expect(lastFrame()).toContain("lists no models")
  expect(lastFrame()).not.toContain("not JSON")
  type("\r")                                  // save without a list
  await wait(30)
  expect(saved[0][1]).toEqual({ baseUrl: "http://r/v1", apiKey: "sk-1" })
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

test("a blank key field on a re-run Tests with the stored key", async () => {
  // Decision 3 makes re-running the form the only refresh path, and the frame
  // invites a blank key ("an empty key field keeps the current key"). The save
  // does keep it — but the Test went out built from the typed fields alone, so
  // an auth-enforcing endpoint answered 401 and the refresh path was unusable
  // without the key at hand (a `{env:VAR}` user never has it).
  const seen: any[] = []
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} existing={["r"]} onSaved={() => {}}
      storedEntry={() => ({ baseUrl: "http://old/v1", apiKey: "sk-stored" })}
      discover={async (cfg: any) => { seen.push({ ...cfg }); return { ok: true, models: ["a"] } }} />,
  )
  type("r\rhttp://r/v1\r\r")                  // blank key
  await wait(30)
  type("\r")                                  // Test
  await wait(40)
  expect(seen).toEqual([{ baseUrl: "http://r/v1", apiKey: "sk-stored" }])
  expect(lastFrame()).toContain("1 model found")
})

test("a stored {env:VAR} key is resolved for the TUI Test, raw in the file", async () => {
  // Decision 2 makes no exception for a key the user did not retype.
  process.env.LUGENT_TUI_STORED = "sk-from-env"
  const auths: (string | undefined)[] = []
  const fetchFn = (async (_u: string, init: any) => {
    auths.push(init?.headers?.authorization)
    return new Response(JSON.stringify({ data: [{ id: "alpha" }] }), { status: 200 })
  }) as any
  const discover = (cfg: any) => discoverModels(cfg, { fetchFn })
  const { type } = renderTui(
    <AddProvider {...base} existing={["r"]} onSaved={() => {}}
      storedEntry={() => ({ baseUrl: "http://old/v1", apiKey: "{env:LUGENT_TUI_STORED}" })}
      discover={discover} />,
  )
  try {
    type("r\rhttp://r/v1\r\r")                // blank key
    await wait(30)
    type("\r")                                // Test — the real discoverModels
    await wait(60)
    expect(auths).toEqual(["Bearer sk-from-env"])
  } finally { delete process.env.LUGENT_TUI_STORED }
})

test("a typed key still wins over the stored one", async () => {
  const seen: any[] = []
  const { type } = renderTui(
    <AddProvider {...base} existing={["r"]} onSaved={() => {}}
      storedEntry={() => ({ baseUrl: "http://old/v1", apiKey: "sk-stored" })}
      discover={async (cfg: any) => { seen.push({ ...cfg }); return { ok: true, models: ["a"] } }} />,
  )
  type("r\rhttp://r/v1\rsk-typed\r")
  await wait(30)
  type("\r")
  await wait(40)
  expect(seen[0].apiKey).toBe("sk-typed")
})

test("a blank key on a brand-new name Tests with no key at all", async () => {
  // The lookup is per name: borrowing another provider's key would authenticate
  // the Test as someone else and hide a missing credential.
  const seen: any[] = []
  const { type } = renderTui(
    <AddProvider {...base} existing={["other"]} onSaved={() => {}}
      storedEntry={n => (n === "other" ? { baseUrl: "http://o/v1", apiKey: "sk-other" } : undefined)}
      discover={async (cfg: any) => { seen.push({ ...cfg }); return { ok: true, models: ["a"] } }} />,
  )
  type("r\rhttp://r/v1\r\r")
  await wait(30)
  type("\r")
  await wait(40)
  expect(seen[0]).toEqual({ baseUrl: "http://r/v1", apiKey: "" })
})

const many = (n: number) => Array.from({ length: n }, (_, i) => `model-${String(i + 1).padStart(3, "0")}`)

/** Drive the form to the import phase with `n` advertised models. */
async function toImport(n: number, saved: any[] = []) {
  const list = many(n)
  const ui = renderTui(
    <AddProvider {...base} onSaved={(name, cfg) => saved.push([name, cfg])}
      discover={() => Promise.resolve({ ok: true, models: list })} />,
  )
  ui.type("r\rhttp://r/v1\rsk-1\r")
  await wait(30)
  ui.type("\r")                                  // Test
  await wait(40)
  return ui
}

test("the import phase is a checklist with nothing selected on a first run", async () => {
  const { lastFrame } = await toImport(3)
  const frame = lastFrame()
  expect(frame).toContain("0 of 3 models selected")
  expect(frame).toContain("[ ] model-001")
  expect(frame).not.toContain("[x]")
  expect(frame).toContain("space toggle")
})

test("space toggles the row under the cursor, twice returns it", async () => {
  const { type, lastFrame } = await toImport(3)
  type(" ")
  await wait(30)
  expect(lastFrame()).toContain("1 of 3 models selected")
  expect(lastFrame()).toContain("[x] model-001")
  type(" ")
  await wait(30)
  expect(lastFrame()).toContain("0 of 3 models selected")
})

test("a checks every row, and pressing it again clears them", async () => {
  const { type, lastFrame } = await toImport(3)
  type("a")
  await wait(30)
  expect(lastFrame()).toContain("3 of 3 models selected")
  type("a")
  await wait(30)
  expect(lastFrame()).toContain("0 of 3 models selected")
})

test("the cursor clamps at the last row, and space there toggles the last model", async () => {
  // `End` used to set `scroll = models.length` and let the render clamp. A cursor
  // cannot: models[sel] would be undefined on the next space.
  const { type, lastFrame } = await toImport(5)
  type("\u001b[F")                            // end
  await wait(30)
  type(" ")                                   // toggle the last row
  await wait(30)
  expect(lastFrame()).toContain("1 of 5 models selected")
  // 5 rows fit MAX_VISIBLE, so the frame carries no window suffix; the point here
  // is that `End` left the cursor on a real row, not one past the end.
  expect(lastFrame()).not.toContain(" of 5 —")
  expect(lastFrame()).toContain("[x] model-005")
})

test("down past the last row does not move the cursor", async () => {
  const { type, lastFrame } = await toImport(2)
  type("\u001b[B\u001b[B\u001b[B")            // three downs on two rows
  await wait(30)
  type(" ")
  await wait(30)
  expect(lastFrame()).toContain("[x] model-002")
  expect(lastFrame()).toContain("1 of 2 model")
})

test("enter writes only the checked models, not the whole list", async () => {
  // The proving test for the demand: one row checked out of 20. The old code
  // writes all 20, so `toEqual(["model-002"])` is RED before the change.
  const saved: any[] = []
  const { type } = await toImport(20, saved)
  type("\u001b[B")                            // down to model-002
  await wait(30)
  type(" ")                                   // check it
  await wait(30)
  type("\r")                                  // import & save
  await wait(30)
  expect(saved.length).toBe(1)
  expect(saved[0][1].models).toEqual(["model-002"])
})

test("enter at zero selected writes nothing and says why", async () => {
  // The "mandatory" requirement had no test at all before this change.
  const saved: any[] = []
  const { type, lastFrame } = await toImport(3, saved)
  type("\r")
  await wait(30)
  expect(saved.length).toBe(0)
  expect(lastFrame()).toContain("select at least one")
})

test("a checked row scrolled out of view is still written", async () => {
  const saved: any[] = []
  const { type, lastFrame } = await toImport(20, saved)
  type(" ")                                   // check model-001
  await wait(30)
  type("\u001b[F")                            // end — model-001 leaves the window
  await wait(30)
  expect(lastFrame()).not.toContain("model-001")
  type(" ")
  await wait(30)
  type("\r")
  await wait(30)
  expect(saved[0][1].models).toEqual(["model-001", "model-020"])
})

test("duplicate ids toggle independently and are written once per checked row", async () => {
  const saved: any[] = []
  const { type } = renderTui(
    <AddProvider {...base} onSaved={(n, c) => saved.push([n, c])}
      discover={() => Promise.resolve({ ok: true, models: ["dup", "dup"] })} />,
  )
  type("r\rhttp://r/v1\rsk-1\r")
  await wait(30)
  type("\r")
  await wait(40)
  type(" ")                                   // first row only
  await wait(30)
  type("\r")
  await wait(30)
  expect(saved[0][1].models).toEqual(["dup"])   // second row unchecked → one entry
})

test("a re-run pre-checks the models the file already holds", async () => {
  // No fixture for this existed: the two re-run tests return entries with no `models`.
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} existing={["r"]}
      storedEntry={() => ({ baseUrl: "http://r/v1", apiKey: "sk-old", models: ["model-002", "model-003"] })}
      discover={() => Promise.resolve({ ok: true, models: ["model-001", "model-002", "model-003"] })} />,
  )
  type("r\rhttp://r/v1\r\r")                 // blank key keeps the stored one
  await wait(30)
  type("\r")
  await wait(40)
  expect(lastFrame()).toContain("2 of 3 models selected")
  expect(lastFrame()).toContain("[x] model-002")
  expect(lastFrame()).toContain("[ ] model-001")
})

test("a stored model the endpoint no longer advertises is reported before the write", async () => {
  const { type, lastFrame } = renderTui(
    <AddProvider {...base}
      storedEntry={() => ({ baseUrl: "http://r/v1", models: ["gone-1", "gone-2", "model-001"] })}
      discover={() => Promise.resolve({ ok: true, models: ["model-001"] })} />,
  )
  type("r\rhttp://r/v1\r\r")
  await wait(30)
  type("\r")
  await wait(40)
  expect(lastFrame()).toContain("2 previously imported models are no longer advertised")
})

test("unchecking a previously imported model says it will be removed", async () => {
  const { type, lastFrame } = renderTui(
    <AddProvider {...base}
      storedEntry={() => ({ baseUrl: "http://r/v1", models: ["model-001", "model-002"] })}
      discover={() => Promise.resolve({ ok: true, models: ["model-001", "model-002"] })} />,
  )
  type("r\rhttp://r/v1\r\r")
  await wait(30)
  type("\r")
  await wait(40)
  expect(lastFrame()).not.toContain("removing")
  type(" ")                                   // uncheck model-001, which the file holds
  await wait(30)
  expect(lastFrame()).toContain("1 previously imported model will be removed")
})

test("both notice lines at once still fit the frame budget", async () => {
  // Task 4's step 4: the two notices are extra rows inside the import block, so
  // the bounded-frame promise the windowing test makes has to survive them.
  const list = many(300)
  const { type, lastFrame } = renderTui(
    <AddProvider {...base} existing={["r"]} onSaved={() => {}}
      storedEntry={() => ({ baseUrl: "http://r/v1", models: ["gone-1", ...list] })}
      discover={() => Promise.resolve({ ok: true, models: list })} />,
    { rows: 30 },
  )
  type("r\rhttp://r/v1\r\r")
  await wait(30)
  type("\r")
  await wait(40)
  type(" ")                                   // uncheck model-001 → "will be removed"
  await wait(40)
  const frame = lastFrame()
  expect(frame).toContain("1 previously imported model is no longer advertised")
  expect(frame).toContain("1 previously imported model will be removed")
  expect(frame.split("\n").length).toBeLessThanOrEqual(22)
})

test("a long model list is windowed so the header and footer stay on screen", async () => {
  // Measured before the fix: 300 models rendered a 69-row frame on a 30-row
  // terminal, pushing the form's own header and footer off the screen.
  const { lastFrame } = await toImport(300)
  const frame = lastFrame()
  expect(frame).toContain("model-001")
  expect(frame).not.toContain("model-300")
  expect(frame).toContain("1-8 of 300")
  expect(frame).toContain("enter import & save")     // the footer still exists
  expect(frame.split("\n").length).toBeLessThanOrEqual(20)  // and the frame is bounded
})

test("down and up move the window by one model", async () => {
  const { type, lastFrame } = await toImport(20)
  type("\u001b[B")                                // down
  await wait(30)
  expect(lastFrame()).toContain("model-002")
  expect(lastFrame()).not.toContain("model-001 ")
  expect(lastFrame()).toContain("2-9 of 20")
  type("\u001b[A")                                // up
  await wait(30)
  expect(lastFrame()).toContain("model-001")
})

test("end jumps to the last window and home returns to the top", async () => {
  const { type, lastFrame } = await toImport(20)
  type("\u001b[F")                                // end
  await wait(30)
  expect(lastFrame()).toContain("model-020")
  expect(lastFrame()).toContain("13-20 of 20")
  type("\u001b[H")                                // home
  await wait(30)
  expect(lastFrame()).toContain("model-001")
  expect(lastFrame()).toContain("1-8 of 20")
})

test("page down moves a full window, clamped at the end", async () => {
  const { type, lastFrame } = await toImport(20)
  type("\u001b[6~")                               // pgdn
  await wait(30)
  expect(lastFrame()).toContain("9-16 of 20")
  type("\u001b[6~")                               // pgdn again — clamps, no overshoot
  await wait(30)
  expect(lastFrame()).toContain("13-20 of 20")
})

test("enter after scrolling still imports every model, not just the window", async () => {
  // Two asserts on purpose: the window assert makes this RED before the feature
  // exists, and the import assert pins the all-or-nothing contract against a
  // future slice of `pendingModelsRef`. Asserting only that `model-020` is
  // visible would pass on the unfixed code, where the un-windowed list renders
  // every id — it must be `model-001` disappearing that proves the window moved.
  const saved: any[] = []
  const { type, lastFrame } = await toImport(20, saved)
  type("\u001b[F")                                // end
  await wait(30)
  expect(lastFrame()).toContain("model-020")
  expect(lastFrame()).not.toContain("model-001")
  type("\r")                                      // import & save
  await wait(30)
  expect(saved.length).toBe(1)
  expect(saved[0][1].models).toEqual(many(20))
})

test("a list that fits the window shows no scroll hint", async () => {
  const { lastFrame } = await toImport(3)
  const frame = lastFrame()
  expect(frame).toContain("3 models found")
  expect(frame).not.toContain(" of 3")
  expect(frame).not.toContain("scroll")
})
