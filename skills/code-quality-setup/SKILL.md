---
name: code-quality-setup
description: Sets up or repairs code-quality gates in a TypeScript repo. Use when a TypeScript project needs formatting, linting, typechecking, tests, coverage, mutation testing, git hooks, or CI gates wired in, audited, or repaired.
---

# code-quality-setup

Wire a TypeScript repo's code-quality gates from a library of recipes, or audit and repair the ones already there. The skill detects the stack, prints a plan, and applies it on approval. It writes files, installs packages, and can commit — never run it unprompted.

## 1. Plan

Run the plan renderer and print its output verbatim. Never improvise the plan.

```
node scripts/plan.mjs [projectDir] [--recipe <id>] [--force] [--diff [path]]   # default projectDir: .
```

`plan.mjs` runs `scripts/detect.mjs` and writes nothing. Both are dependency-free, node builtins only.

| Entry state | What to do |
|---|---|
| a plan exists | print it, ask once, apply on approval |
| already set up | show the drift report (step 4) |
| nothing applies (`selection: []`) | say so; print each recipe's first failing `reason.detail`; write nothing |
| unsupported (no TypeScript) | say so and stop |
| detector hard error | surface stderr and stop |
| a malformed recipe | warn — one `{ id, error }` line per broken file — and plan the rest; fail only when no usable recipe remains |

## 2. Read the plan

The plan is fixed-order: the stack; the selection (priority order, each with title / purpose / cost); the applicability matrix for everything not selected; `heldBack`; `collisions`; the files to be written (path, action, scope — diffs inline for `merge` / `patch` / collision, `create` as `new` / `no-op` / `drift`); the commands in order; the gates and `verify` left behind; unreadable recipes.

Ask once, after the plan. `--diff` prints unified diffs for every file; `--diff <path>` for one.

## 3. Apply

There is no `apply.mjs`: the agent applies. Walk the selection in priority order and follow each recipe's `## Apply` in `references/recipes/<id>.md`. The three phases are global — every recipe's files, then every command, then every verify (see [RECIPE-CONTRACT.md](RECIPE-CONTRACT.md) → Apply order).

Record each recipe in `.code-quality.json` as it completes — recipe-granular, after its `verify` passes. A failed `verify` is reported as-is, not rolled back; that recipe stays unrecorded, so a re-run resumes where it stopped. Declining the plan writes nothing.

## 4. Re-run: the drift report

The filesystem is the source of truth; `.code-quality.json` is an optimization. Per owned file: **intact**; **drifted** (hand-edited → show the diff, apply only on approval, never silently overwrite); **missing** (deleted by hand → reinstate on approval). A `merge` never drifts — its own marker block is replaced. A re-render the current library changed is an **update**, not drift.

## 5. Options

- `--recipe <id>` — narrow to one recipe. The plan is still shown and approved; `when` is never bypassed; `conflicts` still surface; a recipe that `requires` another will not apply alone.
- `--force` — overrides a **collision** only, never a failed `when`.
- `--diff [path]` — unified diffs on demand.

## Reference

- [RECIPE-CONTRACT.md](RECIPE-CONTRACT.md) — the recipe frontmatter and body contract.
- [references/recipes/](references/recipes/) — the recipe library, one file per recipe.
- [scripts/DETECT-SCHEMA.md](scripts/DETECT-SCHEMA.md), [scripts/PLAN-SCHEMA.md](scripts/PLAN-SCHEMA.md) — the two scripts' output contracts.
