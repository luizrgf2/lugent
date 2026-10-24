# Platform and dependencies

**Zero dependencies.** `bun:sqlite`, `Bun.spawn`, `Bun.Glob.scanSync` (the async `scan()` is an AsyncGenerator — `Array.from` silently yields `[]`), `fetch`. No SDK, no framework.

**Platform split.** `platform.ts` centralizes OS choices (db path via `APPDATA`/`XDG_DATA_HOME`, shell `cmd /c` vs `bash -c`) as pure functions — testable without a Windows box.

---

Index: [`docs/architecture.md`](../architecture.md)
