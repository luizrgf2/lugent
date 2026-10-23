---
name: Git Conventions
description: Branch names, commit messages, and decision logging rules — read before creating a branch or commit
---

# Git conventions

## Branches

`<type>/<short-kebab-case-description>`

| Type | Use |
| --- | --- |
| `feat/` | new feature or behavior |
| `fix/` | bug fix |
| `refactor/` | behavior-preserving change |
| `docs/` | documentation only |
| `chore/` | tooling, config, deps |

Examples: `feat/skill-tool`, `fix/sse-fragment-join`, `refactor/platform-helpers`.

## Commits

Conventional: `<type>: <imperative one-liner>`

- Types: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`
- Optional scope: `feat(tools): ...`
- Subject ≤ 72 chars, no trailing period. Body only when the "why" is not obvious.

## Documenting decisions

When a decision has a real trade-off — a ceiling accepted (`ponytail:`), an option deliberately deferred, or a non-obvious choice among alternatives — append an entry to `docs/decisions.md`:

```
## YYYY-MM-DD — short title
Decision: what was chosen.
Why: the constraint or reasoning.
Cost if wrong: the concrete failure mode if this turns out bad.
```

One entry per decision; commit it together with the code that embodies it. Trivial choices (naming, ordering) do not get entries.

Loaded on demand via the `skill` tool — the system prompt only carries this file's name and description.
