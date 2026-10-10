---
name: code-quality-setup
description: Sets up or repairs code-quality gates in a TypeScript repo. Use when a TypeScript project needs formatting, linting, typechecking, tests, coverage, mutation testing, git hooks, or CI gates wired in, audited, or repaired.
---

# code-quality-setup

Wire a TypeScript repo's code-quality gates from a library of recipes, or audit and repair the ones already there. The skill detects the stack, prints a plan, and applies it on approval. It writes files, installs packages, and can commit — never run it unprompted.

## 1. Plan

Run the plan renderer and print its output verbatim. Never improvise the plan.

```
node scripts/plan.mjs [projectDir] [--recipe <id>] [--force] [--diff [path]] [--check]   # default projectDir: .
```

`plan.mjs` runs `scripts/detect.mjs` and writes nothing. Both are dependency-free, node builtins only. `--check` prints the machine-readable drift report (one JSON document) instead of the plan and exits 0 only when it is clean — the `ci-drift` workflow's input ([PLAN-SCHEMA.md](scripts/PLAN-SCHEMA.md) → `--check`).

### The measurement — the floor the apply will install

The plan's **Measurement** section is the adoption flow: for every gate the selection will install (a selected recipe's gate that declares `floor`), it shows the level the gate measures **now** and the floor the apply will install. The floor is the measured level, so the gates are green on day one and can only improve. Greenfield is the same code path: a clean repo measures 100% (or 0), so the floor is the wall — one path, not two.

The plan still writes nothing and runs no gate. It reads the artifacts that already exist (`scripts/score.mjs`'s readers, the same ones the score view uses) and reports each gate as:

| Measured now | Floor the apply installs |
|---|---|
| a level (e.g. `56.7% (34/60)`, `93.3 (A)`, `3`) | that level |
| `_unmeasured_` — no artifact yet | the greenfield wall: 100% for coverage and mutation, 0 for lint and typecheck, fallow's report-only mode |

An artifact older than the newest source file is flagged `⚠ stale`: the level shown is not the level of the code as it stands. The apply re-runs the gate before writing the baseline, so a stale artifact never becomes a floor — the recorded floor is always the level the apply just measured. The plan never runs the heavy gates (Stryker takes minutes); the apply does, once, in the commands/verify phase.

The floor never rises on its own. The gates are read-only checks; only `score.mjs --raise` (or the improvement skill) raises a floor.

| Entry state | What to do |
|---|---|
| a plan exists | print it, ask once, apply on approval |
| already set up | show the drift report (step 4) |
| nothing applies (`selection: []`) | say so; print each recipe's first failing `reason.detail`; write nothing |
| unsupported (no TypeScript) | say so and stop |
| detector hard error | surface stderr and stop |
| a malformed recipe | warn — one `{ id, error }` line per broken file — and plan the rest; fail only when no usable recipe remains |

## 2. Read the plan

The plan is fixed-order: the stack; the selection (priority order, each with title / purpose / cost); the **measurement** (the level each gate measures now and the floor the apply will install); the applicability matrix for everything not selected; `heldBack`; `collisions`; the files to be written (path, action, scope — diffs inline for `merge` / `patch` / collision / loss, `create` as `new` / `no-op` / `drift` / `loss`, a `patch` as `new` / `no-op` / `patch`); the commands in order; the gates and `verify` left behind; unreadable recipes.

Ask once, after the plan. `--diff` prints unified diffs for every file; `--diff <path>` for one.

## 3. Apply

There is no `apply.mjs`: the agent applies. Walk the selection in priority order and follow each recipe's `## Apply` in `references/recipes/<id>.md`. The three phases are global — every recipe's files, then every command, then every verify (see [RECIPE-CONTRACT.md](RECIPE-CONTRACT.md) → Apply order).

### The baseline write — install each gate at the measured level

The gates read their floor from the committed baseline, so the apply writes it at the level the gates just measured. This is what makes the gates green on day one on a debt-carrying repo, and it is the same step on greenfield (the measured level is 100%/0, so the floor is the wall).

After the files are written and the commands have run, and **before** the verify phase, the apply measures the gates and writes the floor:

1. **Capture each gate's artifact** — run the capture command for every selected gate that declares `floor` (the table in [SCORE-SCHEMA.md](scripts/SCORE-SCHEMA.md) → Artifacts): `bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage` (or `vitest run --coverage`), `stryker run`, `oxlint --format json > reports/oxlint.json`, `tsc --noEmit --pretty false > reports/tsc.log`, `fallow health --format json --report-only > reports/fallow-health.json`, `fallow dead-code --format json > reports/fallow-dead-code.json`. The recipe's `commands` only install packages; the artifacts come from these captures. Run them with the config the apply just wrote (the recipe's `.oxlintrc.json`, `stryker.conf.mjs`, …), so the level is the level the installed gate measures.
2. **The unified baseline** — run `node scripts/score.mjs <projectDir> --raise`. It re-measures from the artifacts the captures just produced and writes `.code-quality-baseline.json` (coverage, mutation, lint, typecheck). The plan's Measurement section shows the level it will record; a gate the plan reported `_unmeasured_` is measured here for the first time.
3. **fallow's own baselines** — run the fallow-audit recipe's `fallow:raise` (`bun run fallow:raise` / `npm run fallow:raise`). It writes `.fallow-health-baseline.json` and `.fallow-dead-code-baseline.json`, fallow's floors, which never live in the unified baseline.

`--raise` **merges** with the recorded baseline, it does not overwrite it: the floor never falls. A gate that already has a recorded floor keeps it — a coverage/mutation fraction takes the larger of the current and recorded, a lint/typecheck count takes the smaller, and a recorded gate whose artifact is absent is kept, never dropped. Only a gate with no recorded floor is raised to its measured level. So a repo that already has a baseline is unchanged by an apply, and a repo sitting below its recorded floor stays red — the apply does not lower the floor to make it green.

Both writes are the recipe's own apply step, so the recipe's `verify` (the gate, now floored at the recorded or measured level) passes and the recipe is recorded. A gate whose artifact the captures did not produce and that has no recorded floor stays at the wall — the plan said `_unmeasured_`, and the recipe's `verify` fails as-is, so the recipe stays unrecorded and a re-run resumes there.

The floor never rises on its own: the apply writes it once, and only `score.mjs --raise` (or the improvement skill) raises it afterwards.

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
- `--check` — print the machine-readable drift report (one JSON document: the per-recipe verdicts, the degraded note, and the rendered `## Drift (manifest)` section) instead of the plan, and exit 0 only when it is clean. The `ci-drift` workflow's input ([PLAN-SCHEMA.md](scripts/PLAN-SCHEMA.md) → `--check`).

## 6. Feedback (opt-in)

When a gate fails for a reason the plan did not predict — a detector hard error, a malformed recipe, a `verify` that fails unexpectedly — or the user asks, the skill can file a redacted report to this repo. It is **off** unless `.code-quality.json` carries `feedback: true`:

```
node scripts/manifest.mjs feedback [projectDir] --enable
node scripts/feedback.mjs [projectDir] --recipe <id> --error <text>
```

`feedback.mjs` prints the redacted report and the filing path; it never sends anything — the human files it. See [references/feedback.md](references/feedback.md) and [scripts/FEEDBACK-SCHEMA.md](scripts/FEEDBACK-SCHEMA.md).

## Reference

- [RECIPE-CONTRACT.md](RECIPE-CONTRACT.md) — the recipe frontmatter and body contract.
- [references/recipes/](references/recipes/) — the recipe library, one file per recipe.
- [references/feedback.md](references/feedback.md) — the opt-in feedback channel.
- [scripts/DETECT-SCHEMA.md](scripts/DETECT-SCHEMA.md), [scripts/PLAN-SCHEMA.md](scripts/PLAN-SCHEMA.md), [scripts/SCORE-SCHEMA.md](scripts/SCORE-SCHEMA.md), [scripts/FEEDBACK-SCHEMA.md](scripts/FEEDBACK-SCHEMA.md) — the scripts' output contracts.
