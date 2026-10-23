import { Plugin } from "@opencode/plugin"

// End-of-implementation doc-check trigger (see AGENTS.md "End-of-iteration doc check").
// Fires on session.idle, only when the session mutated files and the working copy
// has code changes without any doc changes. Reminds at most once per mutation batch.
const COOLDOWN_MS = 10 * 60_000
const MUTATING_TOOLS = new Set(["write", "edit", "patch"])

export default Plugin.define({
  id: "lugent.doc-check",
  async setup(ctx) {
    const mutatedAt = new Map<string, number>() // sessionID -> last file mutation
    const remindedAt = new Map<string, number>() // sessionID -> last reminder sent

    await ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "completed") return
      if (!MUTATING_TOOLS.has(event.tool)) return
      mutatedAt.set(event.sessionID, Date.now())
    })

    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        try {
          if (event.type !== "session.idle") continue
          const sessionID = (event as any).data?.sessionID as string | undefined
          if (!sessionID) continue

          const lastMut = mutatedAt.get(sessionID)
          if (!lastMut) continue // session never mutated files — nothing to check
          const lastRem = remindedAt.get(sessionID) ?? 0
          if (lastMut <= lastRem) continue // no mutations since the last reminder
          if (lastRem && Date.now() - lastRem < COOLDOWN_MS) continue

          const loc = (event as any).location?.directory as string | undefined
          if (loc && loc !== ctx.location.directory) continue // other project's session

          const status = await ctx.vcs.status()
          const files = status.map((f: any) => String(f.file ?? ""))
          const isDoc = (f: string) => f === "README.md" || f === "AGENTS.md" || f.startsWith("docs/")
          const code = files.filter((f) => f && !isDoc(f))
          if (code.length === 0 || files.some(isDoc)) continue // docs already touched

          remindedAt.set(sessionID, Date.now())
          await ctx.session.synthetic({
            sessionID,
            text: `[doc-check] Code changed but no docs touched (${code.slice(0, 5).join(", ")}${code.length > 5 ? ", …" : ""}). Run the end-of-iteration doc check from AGENTS.md: update README / docs/architecture.md / docs/decisions.md if anything is stale, or state "docs: no update needed".`,
          })
        } catch {
          // never break the event stream
        }
      }
    })()

    return () => controller.abort()
  },
})
