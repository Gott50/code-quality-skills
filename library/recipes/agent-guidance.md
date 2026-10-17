---
id: agent-guidance
title: Agent guidance — a lean AGENTS.md section pointing at docs/code-quality.md
purpose: Tell coding agents which gates exist, how to run them, and where the detail lives.
when:
  requires: [{ recipe: "*" }]
cost: fast
priority: 0
files:
  - path: AGENTS.md
    action: merge
    scope: root
    template: templates/agent-guidance/AGENTS.md
  - path: AGENTS.md
    action: merge
    scope: member
    memberMode: standalone
    template: templates/agent-guidance/AGENTS.member.md
  - path: docs/code-quality.md
    action: create
    scope: root
    template: templates/agent-guidance/docs/code-quality.md
commands: []
verify:
  - run: test -f docs/code-quality.md && grep -q "code-quality:agent-guidance:start" AGENTS.md
    scope: root
  - run: grep -q "code-quality:agent-guidance:start" AGENTS.md
    scope: each-member
---

## Apply

1. **`docs/code-quality.md`** — create from `templates/agent-guidance/docs/code-quality.md`. Its body is one `{{plan.details}}` substitution: one section per selected recipe, carrying that recipe's `title`, `purpose`, its gates, and its undo bullets. The detail lives here, not in `AGENTS.md`.
2. **`AGENTS.md`** — merge the lean section from `templates/agent-guidance/AGENTS.md`, inside this recipe's marker pair. It carries the gate table (`{{plan.gates}}`), the practice pointer list (`{{plan.practices}}`), and the pointer to `docs/code-quality.md`; everything else is disclosed behind that pointer. A missing `AGENTS.md` is created from the template, which is the whole section.
3. **`<member>/AGENTS.md`** — the same block, merged from `templates/agent-guidance/AGENTS.member.md` into each workspace member. Discovery is nearest-wins, so an agent whose working directory is the member reads that file, and it must carry the gates itself rather than point at the root's copy. The member template differs from the root one in its links only: the detail pointer and the practice pointers are prefixed with `{{root}}`, the member's path back to the workspace root, because a root-relative link from a member points at a file that does not exist. In a single workspace the entry resolves to the same `AGENTS.md` as the root entry and is skipped, so nothing is written twice.

The placeholders are rendered from the *whole selection*, not from this recipe: `{{plan.gates}}` is one table of every selected recipe's gates, `{{plan.details}}` one section per selected recipe, `{{plan.practices}}` one pointer line per selected practice. That is what lets a recipe whose output describes the whole run stay a static template. `{{plan.practices}}` renders the empty string when no practice is selected, so the block carries no dangling lead-in; its links are relative to the file they land in, so the member block's pointers reach the same docs from one directory deeper.

This recipe runs last (`priority: 0`, below every gate) because it documents the recipes the same run selected: with no other recipe selected it does not apply at all (`requires: [{ recipe: "*" }]`).

## Idempotency

- Both targets re-render from the current selection, so a later run that selects a new recipe produces a changed `docs/code-quality.md` and a changed `{{plan.gates}}` table. That difference is drift by design: the plan shows it as the doc catching up, and applies on approval.
- `AGENTS.md` is a `merge`: re-running replaces this recipe's marker block, leaving the rest of the file untouched. The member blocks are the same `merge` in each member, so a member added to the workspace gains its block on the next run and a member removed leaves its file behind (see Undo).
- A repo-wide formatter sweep (`dprint fmt`, `biome format --write`) that re-aligns the block's table is not drift: the plan reads a formatter-only rewrite of the marker block as `intact`, so a clean apply followed by the sweep's own `commands` entry converges. A hand-edit that changes the block's content still reads `drifted`.

## Undo

- Delete `docs/code-quality.md`; delete `docs/` if it is empty.
- Remove the `code-quality:agent-guidance` block from `AGENTS.md`; delete the file if the block is all it holds.
- Remove the same block from each member's `AGENTS.md`; delete the file if the block is all it holds.
