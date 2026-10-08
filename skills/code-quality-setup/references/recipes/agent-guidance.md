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
  - path: docs/code-quality.md
    action: create
    scope: root
    template: templates/agent-guidance/docs/code-quality.md
commands: []
verify:
  - run: test -f docs/code-quality.md && grep -q "code-quality:agent-guidance:start" AGENTS.md
    scope: root
---

## Apply

1. **`docs/code-quality.md`** — create from `templates/agent-guidance/docs/code-quality.md`. Its body is one `{{plan.gates}}` substitution: one section per applied recipe, carrying that recipe's `title`, `purpose`, `commands`, `verify`, and `undo`. The detail lives here, not in `AGENTS.md`.
2. **`AGENTS.md`** — merge the lean section from `templates/agent-guidance/AGENTS.md`, inside this recipe's marker pair. It carries only the command table (`{{plan.commands}}`) and the pointer to `docs/code-quality.md`; everything else is disclosed behind that pointer. A missing `AGENTS.md` is created from the template, which is the whole section.

This recipe runs last (`priority: 0`, below every gate) because it documents the recipes the same run selected: with no other recipe selected it does not apply at all (`requires: [{ recipe: "*" }]`).

## Idempotency

- Both targets re-render from the current selection, so a later run that selects a new recipe produces a changed `docs/code-quality.md` and a changed `{{plan.commands}}` row. That difference is drift by design: the plan shows it as the doc catching up, and applies on approval.
- `AGENTS.md` is a `merge`: re-running replaces this recipe's marker block, leaving the rest of the file untouched.

## Undo

- Delete `docs/code-quality.md`; delete `docs/` if it is empty.
- Remove the `code-quality:agent-guidance` block from `AGENTS.md`; delete the file if the block is all it holds.
