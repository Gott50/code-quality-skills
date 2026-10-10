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

The plan is fixed-order: the stack; the selection (priority order, each with title / purpose / cost); the applicability matrix for everything not selected; `heldBack`; `collisions`; the files to be written (path, action, scope — diffs inline for `merge` / `patch` / collision / loss, `create` as `new` / `no-op` / `drift` / `loss`, a `patch` as `new` / `no-op` / `patch`); the commands in order; the gates and `verify` left behind; unreadable recipes.

Ask once, after the plan. `--diff` prints unified diffs for every file; `--diff <path>` for one.

## 3. Apply

There is no `apply.mjs`: the agent applies. Walk the selection in priority order and follow each recipe's `## Apply` in `references/recipes/<id>.md`. The three phases are global — every recipe's files, then every command, then every verify (see [RECIPE-CONTRACT.md](RECIPE-CONTRACT.md) → Apply order).

A file row whose verdict is **`duplicate`** (see the plan's *Pre-existing content* section) is a marker block the target file already carries without a marker — a hand-set-up repo, or one set up by an earlier version. Do **not** append it: the gate is already wired, and appending would run it twice. Skip the block; the plan renders the recipe's `verify` with the skipped block's marker grep replaced by `true`, so run the verify **as the plan renders it** — it passes and the recipe is recorded (RECIPE-CONTRACT.md → `verify`).

A file row whose verdict is **`loss`** (see the plan's *Losses* section) is a `create` target the repo has customized: the repo's file carries content the template does not, so overwriting it drops that content. Do **not** overwrite it — leave the repo's file as it is — unless the human explicitly overrides (`--force`). The plan shows the diff and the lost lines; the recipe's `verify` still runs as-is, so a verify that depends on the skipped file fails and that recipe stays unrecorded (RECIPE-CONTRACT.md → `files`).

A file row whose verdict is **`no-op`** on a `patch` is the after-state the recipe body states already holding: the target declares every key the template declares, with the template's scalar values. Write nothing for that entry — the patch is done — and record it like any other file (RECIPE-CONTRACT.md → `files`).

Record each recipe in `.code-quality.json` as it completes — recipe-granular, after its `verify` passes — through the canonical writer, never by hand:

```
node scripts/manifest.mjs record [projectDir] --recipe <id> --recipe-hash <hash> \
  --file <path>:<action>:<hash> ... [--skill-version <v>] [--environment <json>]
```

The writer sorts keys, indents with two spaces, and ends with a newline, so the committed manifest passes the formatter recipes' `format:check` (ADR 0002). The hashes are the ones [PLAN-SCHEMA.md](scripts/PLAN-SCHEMA.md) → the manifest hash convention defines. A declined recipe is recorded with `node scripts/manifest.mjs decline [projectDir] --recipe <id>`. A failed `verify` is reported as-is, not rolled back; that recipe stays unrecorded, so a re-run resumes where it stopped. Declining the plan writes nothing.

## 4. Re-run: the drift report

The filesystem is the source of truth; `.code-quality.json` is an optimization. Per owned file: **intact**; **drifted** (hand-edited → show the diff, apply only on approval, never silently overwrite); **missing** (deleted by hand → reinstate on approval); **loss** (a `create` target the repo customized — the repo's file carries content the template does not, so it is skipped, not overwritten). A `merge` never drifts — its own marker block is replaced. A `patch` whose after-state holds is `intact`, not `drifted`: the recipe owns the keys its template declares, not the file, so the repo's other content and its extended collections are not drift. A re-render the current library changed is an **update**, not drift.

## 5. Options

- `--recipe <id>` — narrow to one recipe. The plan is still shown and approved; `when` is never bypassed; `conflicts` still surface; a recipe that `requires` another will not apply alone.
- `--force` — overrides a **collision** or a **loss** (a `create` drift that would drop the repo's extra content), never a failed `when`.
- `--diff [path]` — unified diffs on demand.

## Reference

- [RECIPE-CONTRACT.md](RECIPE-CONTRACT.md) — the recipe frontmatter and body contract.
- [references/recipes/](references/recipes/) — the recipe library, one file per recipe.
- [scripts/DETECT-SCHEMA.md](scripts/DETECT-SCHEMA.md), [scripts/PLAN-SCHEMA.md](scripts/PLAN-SCHEMA.md) — the two scripts' output contracts.
