---
id: bun-test-coverage
title: bun test with a 100% per-file coverage gate
purpose: Run the test suite under bun and fail the build when any file is below 100% line or function coverage.
when:
  language: [typescript, javascript]
  packageManager: [bun]
  workspace: single
  requires: [{ file: package.json }]
conflicts:
  tools: [vitest, jest]
cost: fast
priority: 35
files:
  - path: scripts/coverage-gate.ts
    action: create
    scope: root
    template: templates/bun-test-coverage/scripts/coverage-gate.ts
  - path: bunfig.toml
    action: patch
    scope: root
    template: templates/bun-test-coverage/bunfig.toml
  - path: package.json
    action: merge
    scope: root
    template: templates/bun-test-coverage/package.json
  - path: .husky/pre-commit
    action: merge
    scope: root
    template: templates/bun-test-coverage/pre-commit.block
  - path: .gitignore
    action: merge
    scope: root
    template: templates/bun-test-coverage/gitignore.block
commands:
  - run: bun install
    scope: root
    showInPlan: false
gates:
  - id: test
    run: bun run test
    description: bun test with the 100% per-file lines-and-functions coverage gate
verify:
  - gate: test
    scope: root
---

## Apply

1. **`scripts/coverage-gate.ts`** — create from `templates/bun-test-coverage/scripts/coverage-gate.ts`. It reads bun's lcov output and fails listing every file below the threshold on **either** line or function coverage. bun's own `coverageThreshold` is global, which is why the per-file gate is a script.
2. **`bunfig.toml`** — a `patch`, not a `merge`: the target is TOML, and a marker block carrying its own `[test]` header would duplicate a table the project may already declare. The before/after is exact — **before**: no `[test]` table, or a `[test]` table without `coveragePathIgnorePatterns`; **after**: `[test]` declares `coverage = true` and `coveragePathIgnorePatterns = ["**/tmp/**", "**/*-bin.ts"]`. A missing `bunfig.toml` is created from the template. The detector cannot verify a `patch`, so the plan always shows it.
3. **`package.json`** — merge from `templates/bun-test-coverage/package.json`: set the `test` script to `bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage && bun scripts/coverage-gate.ts --lcov coverage/lcov.info --threshold 100`. A project that already has a `test` script with a different value is a collision the plan must show.
4. **`.husky/pre-commit`** — merge from `templates/bun-test-coverage/pre-commit.block`, inside this recipe's marker pair.
5. **`.gitignore`** — merge from `templates/bun-test-coverage/gitignore.block`, inside this recipe's marker pair: `coverage/`.
6. **`bun install`** — no new dependency, but the install is what makes the script runnable in a fresh checkout.

`coveragePathIgnorePatterns` is the one setting that cannot move to the command line: bun has no CLI flag for it. It exists for process entrypoints — a thin `import.meta.main` bootstrap that only ever runs as a subprocess, which bun cannot instrument, so it can never reach 100%. A project with such a file must add its own pattern; the template's `**/*-bin.ts` is the convention.

The gate is a wall, not a slope: on a repo that is not already at 100% per file, `bun run test` fails and lists the files. That is the gate working. The recipe's files are correct, the plan shows the gap before applying, and the recipe stays unrecorded until the project climbs to 100%.

## Idempotency

- `scripts/coverage-gate.ts` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `bunfig.toml` is a `patch`: re-applying to the same before-state is a no-op, and a hand-edited file shows as drift.
- `package.json`, `.husky/pre-commit` and `.gitignore` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Delete `scripts/coverage-gate.ts`; delete `scripts/` if it is empty.
- Remove the `[test]` keys this recipe added from `bunfig.toml`; delete the file if the fragment is all it holds.
- Restore the previous `test` script in `package.json` — only where this recipe replaced it.
- Remove the `code-quality:bun-test-coverage` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- Remove the `code-quality:bun-test-coverage` block from `.gitignore`; delete the file if the block is all it holds.
- Delete `coverage/`.
