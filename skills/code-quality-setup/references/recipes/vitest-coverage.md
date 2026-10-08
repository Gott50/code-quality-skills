---
id: vitest-coverage
title: Vitest with a 100% per-file coverage gate (npm/pnpm)
purpose: Run the test suite under Vitest and fail the build when any file is below 100% line or function coverage.
when:
  language: [typescript, javascript]
  packageManager: [npm, pnpm]
  workspace: single
  requires: [{ file: package.json }]
conflicts:
  tools: [jest]
cost: fast
priority: 35
files:
  - path: vitest.config.ts
    action: create
    scope: root
    template: templates/vitest-coverage/vitest.config.ts
  - path: package.json
    action: merge
    scope: root
    template: templates/vitest-coverage/package.json
  - path: .husky/pre-commit
    action: merge
    scope: root
    template: templates/vitest-coverage/pre-commit.block
  - path: .gitignore
    action: merge
    scope: root
    template: templates/vitest-coverage/gitignore.block
commands:
  - run: sh -c 'test -f pnpm-lock.yaml && pnpm install || npm install'
    scope: root
    showInPlan: false
gates:
  - id: test
    run: npm run test
    description: vitest run with the 100% per-file lines-and-functions coverage gate
verify:
  - gate: test
    scope: root
---

## Apply

1. **`vitest.config.ts`** — create from `templates/vitest-coverage/vitest.config.ts`. Vitest's built-in `coverage.thresholds` replaces the Bun recipe's `scripts/coverage-gate.ts`: `perFile: true` with `lines: 100` and `functions: 100` fails the run on any file below the threshold, which is exactly what the hand-written gate did. Two settings are load-bearing:
   - **`coverage.include`** — without it, a file no test imports vanishes from the denominator and the gate passes on an untested file. `src/**/*.ts` is the convention; a project whose source is not under `src/` must widen it.
   - **`coverage.exclude: ["**/*-bin.ts"]`** — a thin process entrypoint that only ever runs as a subprocess is never executed in-process, so it can never reach 100%. A project with such a file must add its own pattern.
   The provider is `istanbul`, not the default `v8`: the v8 provider does not work on non-V8 runtimes, and istanbul's `json` reporter writes `coverage/coverage-final.json`, which is what `fallow-audit-npm` consumes. The Bun recipe's `scripts/lcov-to-istanbul.ts` bridge is therefore not needed here.
2. **`package.json`** — merge from `templates/vitest-coverage/package.json`: add the `vitest` and `@vitest/coverage-istanbul` devDependencies and the `test` script. A project that already has a `test` script with a different value is a collision the plan must show.
3. **`.husky/pre-commit`** — merge from `templates/vitest-coverage/pre-commit.block`, inside this recipe's marker pair.
4. **`.gitignore`** — merge from `templates/vitest-coverage/gitignore.block`, inside this recipe's marker pair: `coverage/`.
5. **The install** — `sh -c 'test -f pnpm-lock.yaml && pnpm install || npm install'`, installing the two devDependencies.

The gate is a wall, not a slope: on a repo that is not already at 100% per file, `npm run test` fails and lists the files. That is the gate working. The recipe's files are correct, the plan shows the gap before applying, and the recipe stays unrecorded until the project climbs to 100%.

## Idempotency

- `vitest.config.ts` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `package.json`, `.husky/pre-commit` and `.gitignore` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Delete `vitest.config.ts`.
- Remove the `vitest` and `@vitest/coverage-istanbul` devDependencies and the `test` script from `package.json` — only where this recipe added them.
- Remove the `code-quality:vitest-coverage` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- Remove the `code-quality:vitest-coverage` block from `.gitignore`; delete the file if the block is all it holds.
- Delete `coverage/`.
- Run the project's install to drop the packages.
