# Code quality

Wired by the `code-quality-setup` skill. `AGENTS.md` points here; this file holds the detail.

{{plan.details}}

## Invariants

- Nothing is written before the plan is approved; a collision (a merge that would change an existing value, or a conflicting tool) is shown and applied only on approval.
- The filesystem is the source of truth. Re-run the skill to report drift between the config on disk and the recipes that wrote it.
- Marker-delimited blocks (`code-quality:<recipe>`) are owned by their recipe: edit them only by editing the recipe, or the next run reports drift.
