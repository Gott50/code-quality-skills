---
id: stryker-mutation
title: Stryker mutation gate on pre-push
purpose: Gate pushes on full mutation coverage of the changed source files, with incremental caching.
when:
  language: [typescript, javascript]
  packageManager: [bun]
  workspace: any
  requires: [{ file: package.json }]
cost: heavy
priority: 30
files:
  - path: stryker.conf.mjs
    action: create
    scope: root
    template: templates/stryker-mutation/stryker.conf.mjs
  - path: stryker.conf.mjs
    action: create
    scope: member
    memberMode: extends-root
    template: templates/stryker-mutation/stryker.member.conf.mjs
  - path: scripts/mutation-gate.ts
    action: create
    scope: root
    template: templates/stryker-mutation/scripts/mutation-gate.ts
  - path: package.json
    action: merge
    scope: root
    template: templates/stryker-mutation/package.json
  - path: package.json
    action: merge
    scope: member
    template: templates/stryker-mutation/package.member.json
  - path: .husky/pre-push
    action: merge
    scope: root
    template: templates/stryker-mutation/pre-push.block
  - path: .gitignore
    action: merge
    scope: root
    template: templates/stryker-mutation/gitignore.block
commands:
  - run: bun install
    scope: root
    showInPlan: false
gates:
  - id: mutation
    run: bun run test:mutation
    description: Stryker over the whole mutation scope, 100% thresholds
verify:
  - gate: mutation
    scope: each-member
---

## Apply

1. **`stryker.conf.mjs`** — create from `templates/stryker-mutation/stryker.conf.mjs`. `thresholds: { break: 100, high: 100, low: 100 }` makes any survivor fail the run: `break` is the threshold that sets the exit code (Stryker 10), while `high`/`low` only colour the report, so a config with `high`/`low` alone never fails a build. `bun.testFiles` is the runner's own list and is **not** the top-level `testFiles` globs: the bun runner reads the former, and without it every mutant runs the whole suite and times out. `mutate` is the mutation scope — `src/**/*.ts` minus tests, declarations, `-bin.ts` entrypoints and coverage output. **A project whose source is not under `src/` must widen `mutate`, and must keep `scripts/` and `tools/` out of it**: the bun runner's preload imports every file in the mutation set, so their module-level code executes during the dry run — `scripts/coverage-gate.ts` calls `process.exit(1)` when its lcov is missing, which kills the run before a single mutant is tested.
2. **Workspace member `stryker.conf.mjs`** — create from `templates/stryker-mutation/stryker.member.conf.mjs`. A stub that imports the root base through `{{root}}`, the member's path back to the workspace root (`../..` for `packages/a`, `../../..` for `packages/nested/b`), so the import resolves at any depth. It overrides `mutate`, `testFiles` and `bun.testFiles` with the member's own scope — Stryker reads its config from the cwd and resolves those globs against it, and the gate runs this config from the member directory — and it overrides `jsonReporter.fileName` to `{{root}}/reports/mutation/report.json` so the report lands at the workspace root rather than inside the member (see the report-path bullet below). Skipped in a single-package repo, where the root entry writes the same path.
3. **`scripts/mutation-gate.ts`** — create from `templates/stryker-mutation/scripts/mutation-gate.ts`. It reads the pre-push hook's stdin (one line per pushed ref), diffs the pushed commits against the remote tip, and runs Stryker scoped to the changed files with `--incremental`. `AREA_CONFIGS` maps a directory prefix to a Stryker config; the plan renderer substitutes it from the detector's member list via `{{plan.areas}}` — one catch-all entry in a single repo, plus one entry per workspace member.
4. **`package.json`** — merge from `templates/stryker-mutation/package.json`: add the `@stryker-mutator/core` and `@hughescr/stryker-bun-runner` devDependencies and the `test:mutation` script.
5. **Workspace member `package.json`** — merge from `templates/stryker-mutation/package.member.json`: add the `test:mutation` script. `bun run` resolves a script from the nearest `package.json` only — it does not walk up past a member's own manifest — so without this script the per-member verify dies with `Script not found: test:mutation`. The member needs no devDependencies of its own: the two packages are hoisted to the root `node_modules`, and `bun run` puts the root `.bin` on the script's `PATH`. Skipped in a single-package repo, where the root entry writes the same path.
6. **`.husky/pre-push`** — merge from `templates/stryker-mutation/pre-push.block`, inside this recipe's marker pair.
7. **`.gitignore`** — merge from `templates/stryker-mutation/gitignore.block`, inside this recipe's marker pair: `reports/` and `.stryker-tmp/`. The incremental cache lives under `reports/`, so it is never committed.
8. **`bun install`** — installs the two devDependencies.

Five things the gate does that a bare `stryker run` does not:

- **It scopes to the changed files.** A full-suite run on every push is far too slow. `--mutate` on the command line **overrides** the config, so the gate reads the config's own `mutate` globs and filters the changed files through them first. That filter is load-bearing, not cosmetic: the bun runner eagerly imports every file in the mutation set into the test process (`eager modules from mutate globs`), so a changed build script or vendored plugin in `--mutate` would execute its top-level code inside the dry run — `scripts/coverage-gate.ts` prints its "lcov not found" error and exits 1, aborting the push.
- **It fails on timeouts, not just the score.** Stryker counts `TimedOut` mutants as killed, so a 100% run can still contain timeouts, and the exit code does not enforce "no timeouts". The gate parses the report JSON and fails on any `TimedOut`, `Survived` or `NoCoverage` mutant.
- **It reads one report path for every config.** A member config runs with cwd = the member directory, so a member-relative `jsonReporter.fileName` would land inside the member while the gate reads the workspace root — the two would disagree and the gate would fail closed on a missing report. The member stub therefore writes `{{root}}/reports/mutation/report.json` (the root, whatever the member's depth) and the gate reads `reports/mutation/report.json` at the root for every config. The incremental cache stays per-area (`incremental.<area>.json`), so members do not share cache state. The **HTML** report is deliberately left member-relative: the JSON must sit at one path because the gate reads it, but the browsable report is a human artifact, and one file per area beats a single root file that each member's run would overwrite.
- **It resets the report before each run and scopes the counts to the pushed files.** Stryker's `jsonReporter` accumulates files across runs, and with `--incremental` it re-emits cached files that are not in the current `--mutate` set; without both guards a stale survivor from another push would false-fail.
- **It fails closed on a missing report**, unless Stryker's own `Instrumented <N> source file(s) with 0 mutant` line confirms a genuinely zero-mutant run. A push touching only type-only files instruments nothing and writes no report; a bare "report must exist" check would false-fail it.

The gate diffs committed SHAs, so it only runs on files present in a commit. To prove the wiring, make a throwaway commit, run the gate against `HEAD~1..HEAD`, then `git reset --mixed HEAD~1`; a `HEAD..HEAD` diff prints "no mutation-scoped source changed, skipping" and proves nothing.

`bun run test:mutation` over the whole scope is slow, and on a repo with survivors it fails. That is the gate working: the plan shows the gap before applying, and the recipe stays unrecorded until the project reaches zero survivors.

## Idempotency

- `stryker.conf.mjs` (root and member) and `scripts/mutation-gate.ts` are `create`s: byte-identical on re-run, so they are no-ops. A local edit shows as drift and is reported, not overwritten.
- `package.json` (root and member), `.husky/pre-push` and `.gitignore` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.
- The incremental cache under `reports/mutation/` is gitignored and safe to delete; a missing cache only makes the next run slower.

## Undo

- Delete `stryker.conf.mjs`.
- Delete the member `stryker.conf.mjs` in a workspace.
- Delete `scripts/mutation-gate.ts`; delete `scripts/` if it is empty.
- Remove the `@stryker-mutator/core` and `@hughescr/stryker-bun-runner` devDependencies and the `test:mutation` script from `package.json` — only where this recipe added them.
- Remove the `test:mutation` script from the member `package.json` in a workspace — only where this recipe added it.
- Remove the `code-quality:stryker-mutation` block from `.husky/pre-push`; delete the file if the block is all it holds.
- Remove the `code-quality:stryker-mutation` block from `.gitignore`; delete the file if the block is all it holds.
- Delete `reports/` and `.stryker-tmp/`.
- `bun install` to drop the packages.
