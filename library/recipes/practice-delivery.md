---
id: practice-delivery
title: Practice delivery — one doc per selected practice
purpose: Write each selected practice to docs/code-quality/practices/<id>.md so the agent can read it.
when:
  requires: [{ practice: "*" }]
cost: fast
priority: 1
files:
  - path: docs/code-quality/practices/{{practice.id}}.md
    action: create
    scope: root
    template: practices/{{practice.id}}.md
commands: []
gates: []
verify:
  - run: for f in $(grep -o "docs/code-quality/practices/[a-z0-9-]*\.md" AGENTS.md 2>/dev/null) docs/code-quality/practices/*.md; do test -f "$f" && grep -q "^# " "$f" || exit 1; done
    scope: root
---

## Apply

1. **`docs/code-quality/practices/{{practice.id}}.md`** — one `create` per selected practice, from `practices/{{practice.id}}.md`. The `files` entry is expanded once per selected practice: the `{{practice.id}}` placeholder in `path` and `template` is replaced with the practice's id, so a run that selects three practices writes three files, each with its own manifest entry, its own drift verdict, and its own undo. The delivered doc is `# <title>` then the practice body; the practice's `source` and `enforcedBy` are library-internal and never rendered.

This recipe runs after the gates (`priority: 1`, above `agent-guidance`'s `0`) and only when a practice is selected (`requires: [{ practice: "*" }]`). The `agent-guidance` block points at the delivered files through `{{plan.practices}}`, so the two recipes agree on the same list — and the `verify` reads that list back: it checks every pointer line's file exists with its `# ` heading, so a missing or heading-less doc fails the recipe.

## Idempotency

- Each target is a `create`: byte-identical on re-run, so it is a no-op. A hand-edited practice doc shows as drift and is reported, not overwritten.
- A practice the library drops is not deleted by a re-run — the manifest records it as `stale`; remove the file by hand (see Undo).
- A practice the library adds is a new `create` on the next run.

## Undo

- Delete `docs/code-quality/practices/<id>.md` for each delivered practice.
- Delete `docs/code-quality/practices/` and `docs/code-quality/` if they are empty.
