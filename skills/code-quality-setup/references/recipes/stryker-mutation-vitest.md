---
id: stryker-mutation-vitest
title: Stryker mutation gate on pre-push (npm/pnpm)
purpose: Gate pushes on full mutation coverage of the changed source files, with incremental caching.
when:
  language: [typescript, javascript]
  packageManager: [npm, pnpm]
  workspace: single
  requires: [{ file: package.json }, { recipe: vitest-coverage }]
cost: heavy
priority: 30
files:
  - path: stryker.conf.mjs
    action: create
    scope: root
    template: templates/stryker-mutation-vitest/stryker.conf.mjs
  - path: scripts/mutation-gate.ts
    action: create
    scope: root
    template: templates/stryker-mutation/scripts/mutation-gate.ts
  - path: package.json
    action: merge
    scope: root
    template: templates/stryker-mutation-vitest/package.json
  - path: .husky/pre-push
    action: merge
    scope: root
    template: templates/stryker-mutation-vitest/pre-push.block
  - path: .gitignore
    action: merge
    scope: root
    template: templates/stryker-mutation-vitest/gitignore.block
commands:
  - run: sh -c 'test -f pnpm-lock.yaml && pnpm install || npm install'
    scope: root
    showInPlan: false
gates:
  - id: mutation
    run: npm run test:mutation
    description: Stryker over the whole mutation scope, 100% thresholds
verify:
  - gate: mutation
    scope: root
---

## Apply

1. **`stryker.conf.mjs`** — create from `templates/stryker-mutation-vitest/stryker.conf.mjs`. `thresholds: { high: 100, low: 100 }` makes any survivor fail the run. The runner is `@stryker-mutator/vitest-runner`, and the only structural difference from the Bun config is `testFiles`: the bun runner reads its own `bun.testFiles` directory list, while the vitest runner reads the **top-level** `testFiles` globs, so the same scope is written as `test/**/*.test.ts`. The vitest runner ignores `coverageAnalysis` (it is always `perTest`); it is stated anyway, because a reader comparing the two configs should not have to guess.
2. **`scripts/mutation-gate.ts`** — create from `templates/stryker-mutation/scripts/mutation-gate.ts`, the same script the Bun recipe writes. It derives its Stryker invocation from the lockfile (`bunx` under Bun, `npx` under npm and pnpm), so one implementation serves both recipes rather than a 300-line duplicate that differs in one token. It reads the pre-push hook's stdin, diffs the pushed commits against the remote tip, and runs Stryker scoped to the changed files with `--incremental`.
3. **`package.json`** — merge from `templates/stryker-mutation-vitest/package.json`: add the `@stryker-mutator/core`, `@stryker-mutator/vitest-runner` and `tsx` devDependencies and the `test:mutation` script. `tsx` is what the hook uses to run the TypeScript gate under Node.
4. **`.husky/pre-push`** — merge from `templates/stryker-mutation-vitest/pre-push.block`, inside this recipe's marker pair: the Bun recipe's block with `bun scripts/mutation-gate.ts` → `npx tsx scripts/mutation-gate.ts`.
5. **`.gitignore`** — merge from `templates/stryker-mutation-vitest/gitignore.block`, inside this recipe's marker pair: `reports/` and `.stryker-tmp/`. The incremental cache lives under `reports/`, so it is never committed.
6. **The install** — `sh -c 'test -f pnpm-lock.yaml && pnpm install || npm install'`, installing the three devDependencies.

Four things the gate does that a bare `stryker run` does not, unchanged from the Bun recipe: it **scopes to the changed files** (and filters them through the config's own `mutate` globs first, because `--mutate` on the command line overrides the config); it **fails on timeouts**, not just the score (Stryker counts `TimedOut` as killed); it **resets the report before each run** and scopes the counts to the pushed files (the `jsonReporter` accumulates across runs and `--incremental` re-emits cached files); and it **fails closed on a missing report** unless Stryker's own "Instrumented <N> source file(s) with 0 mutant" line confirms a genuinely zero-mutant run.

This recipe requires `vitest-coverage`: the vitest runner needs `vitest` installed, and without that recipe the run has no test runner. The detector reports the missing requirement as the failing reason rather than applying a half-wired gate.

`bun run test:mutation` over the whole scope is slow, and on a repo with survivors it fails. That is the gate working: the plan shows the gap before applying, and the recipe stays unrecorded until the project reaches zero survivors.

## Idempotency

- `stryker.conf.mjs` and `scripts/mutation-gate.ts` are `create`s: byte-identical on re-run, so they are no-ops. A local edit shows as drift and is reported, not overwritten.
- `package.json`, `.husky/pre-push` and `.gitignore` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.
- The incremental cache under `reports/mutation/` is gitignored and safe to delete; a missing cache only makes the next run slower.

## Undo

- Delete `stryker.conf.mjs`.
- Delete `scripts/mutation-gate.ts`; delete `scripts/` if it is empty.
- Remove the `@stryker-mutator/core`, `@stryker-mutator/vitest-runner` and `tsx` devDependencies and the `test:mutation` script from `package.json` — only where this recipe added them.
- Remove the `code-quality:stryker-mutation-vitest` block from `.husky/pre-push`; delete the file if the block is all it holds.
- Remove the `code-quality:stryker-mutation-vitest` block from `.gitignore`; delete the file if the block is all it holds.
- Delete `reports/` and `.stryker-tmp/`.
- Run the project's install to drop the packages.
