# Testing

One test file per module plus `src/e2e.test.ts` (full turn: skill advertisement in prefix, tool call, prefix stability across iterations). Golden snapshot: `src/core/__snapshots__/`. The project was built test-first throughout.

## TUI

`harness.tsx` renders through ink's real `render()` with fake stdin/stdout: frames are captured, ANSI-stripped, asserted with `toContain`. Keys are typed one per write (`type("hi\r")`) mirroring raw-mode terminals. `ink-testing-library` declares `ink: ^5` and misbehaves on v8 (triplicated events, stale frames) — do not reintroduce it.

---

Index: [`docs/architecture.md`](../architecture.md)
