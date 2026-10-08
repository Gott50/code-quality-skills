---
id: stryker-mutation
title: Stryker mutation gate on pre-push
purpose: Gate pushes on full mutation coverage of the changed source files, with incremental caching.
when:
  language: [typescript, javascript]
  packageManager: [bun]
  workspace: single
  requires: [{ file: package.json }]
cost: heavy
priority: 30
files:
  - path: stryker.conf.mjs
    action: create
    scope: root
    template: templates/stryker-mutation/stryker.conf.mjs
  - path: scripts/mutation-gate.ts
    action: create
    scope: root
    template: templates/stryker-mutation/scripts/mutation-gate.ts
  - path: package.json
    action: merge
    scope: root
    template: templates/stryker-mutation/package.json
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
    scope: root
---

## Apply

1. **`stryker.conf.mjs`** — create from `templates/stryker-mutation/stryker.conf.mjs`. `thresholds: { high: 100, low: 100 }` makes any survivor fail the run. `bun.testFiles` is the runner's own list and is **not** the top-level `testFiles` globs: the bun runner reads the former, and without it every mutant runs the whole suite and times out. `mutate` is the mutation scope — `src/**/*.ts` minus tests, declarations, `-bin.ts` entrypoints and coverage output. **A project whose source is not under `src/` must widen `mutate`, and must keep `scripts/` and `tools/` out of it**: those have no covering test, so instrumenting them fails the dry run.
2. **`scripts/mutation-gate.ts`** — create from `templates/stryker-mutation/scripts/mutation-gate.ts`. It reads the pre-push hook's stdin (one line per pushed ref), diffs the pushed commits against the remote tip, and runs Stryker scoped to the changed files with `--incremental`. `AREA_CONFIGS` maps a directory prefix to a Stryker config; the default is one catch-all entry, and a workspace adds one entry per member.
3. **`package.json`** — merge from `templates/stryker-mutation/package.json`: add the `@stryker-mutator/core` and `@hughescr/stryker-bun-runner` devDependencies and the `test:mutation` script.
4. **`.husky/pre-push`** — merge from `templates/stryker-mutation/pre-push.block`, inside this recipe's marker pair.
5. **`.gitignore`** — merge from `templates/stryker-mutation/gitignore.block`, inside this recipe's marker pair: `reports/` and `.stryker-tmp/`. The incremental cache lives under `reports/`, so it is never committed.
6. **`bun install`** — installs the two devDependencies.

Four things the gate does that a bare `stryker run` does not:

- **It scopes to the changed files.** A full-suite run on every push is far too slow. `--mutate` on the command line **overrides** the config, so the gate reads the config's own `mutate` globs and filters the changed files through them first. That filter is load-bearing, not cosmetic: the bun runner eagerly imports every file in the mutation set into the test process (`eager modules from mutate globs`), so a changed build script or vendored plugin in `--mutate` would execute its top-level code inside the dry run — `scripts/coverage-gate.ts` prints its "lcov not found" error and exits 1, aborting the push.
- **It fails on timeouts, not just the score.** Stryker counts `TimedOut` mutants as killed, so a 100% run can still contain timeouts, and the exit code does not enforce "no timeouts". The gate parses the report JSON and fails on any `TimedOut`, `Survived` or `NoCoverage` mutant.
- **It resets the report before each run and scopes the counts to the pushed files.** Stryker's `jsonReporter` accumulates files across runs, and with `--incremental` it re-emits cached files that are not in the current `--mutate` set; without both guards a stale survivor from another push would false-fail.
- **It fails closed on a missing report**, unless Stryker's own `Instrumented <N> source file(s) with 0 mutant` line confirms a genuinely zero-mutant run. A push touching only type-only files instruments nothing and writes no report; a bare "report must exist" check would false-fail it.

The gate diffs committed SHAs, so it only runs on files present in a commit. To prove the wiring, make a throwaway commit, run the gate against `HEAD~1..HEAD`, then `git reset --mixed HEAD~1`; a `HEAD..HEAD` diff prints "no mutation-scoped source changed, skipping" and proves nothing.

`bun run test:mutation` over the whole scope is slow, and on a repo with survivors it fails. That is the gate working: the plan shows the gap before applying, and the recipe stays unrecorded until the project reaches zero survivors.

## Idempotency

- `stryker.conf.mjs` and `scripts/mutation-gate.ts` are `create`s: byte-identical on re-run, so they are no-ops. A local edit shows as drift and is reported, not overwritten.
- `package.json`, `.husky/pre-push` and `.gitignore` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.
- The incremental cache under `reports/mutation/` is gitignored and safe to delete; a missing cache only makes the next run slower.

## Undo

- Delete `stryker.conf.mjs`.
- Delete `scripts/mutation-gate.ts`; delete `scripts/` if it is empty.
- Remove the `@stryker-mutator/core` and `@hughescr/stryker-bun-runner` devDependencies and the `test:mutation` script from `package.json` — only where this recipe added them.
- Remove the `code-quality:stryker-mutation` block from `.husky/pre-push`; delete the file if the block is all it holds.
- Remove the `code-quality:stryker-mutation` block from `.gitignore`; delete the file if the block is all it holds.
- Delete `reports/` and `.stryker-tmp/`.
- `bun install` to drop the packages.
