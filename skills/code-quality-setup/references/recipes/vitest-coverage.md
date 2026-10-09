---
id: vitest-coverage
title: Vitest with a 100% per-file coverage gate (npm/pnpm)
purpose: Run the test suite under Vitest and fail the build when any file is below 100% line or function coverage.
when:
  language: [typescript, javascript]
  packageManager: [npm, pnpm]
  workspace: any
  requires: [{ file: package.json }]
conflicts:
  tools: [jest]
cost: fast
priority: 35
files:
  - path: vitest.config.ts
    action: create
    scope: member
    memberMode: standalone
    template: templates/vitest-coverage/vitest.config.ts
  - path: package.json
    action: merge
    scope: root
    template: templates/vitest-coverage/package.json
  - path: package.json
    action: merge
    scope: member
    template: templates/vitest-coverage/package.member.json
  - path: .husky/pre-commit
    action: merge
    scope: root
    template: templates/vitest-coverage/pre-commit.block
  - path: .gitignore
    action: merge
    scope: root
    template: templates/vitest-coverage/gitignore.block
commands:
  - run: sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'
    scope: root
    showInPlan: false
gates:
  - id: test
    run: npm run test
    description: vitest run with the 100% per-file lines-and-functions coverage gate
verify:
  - gate: test
    scope: each-member
---

## Apply

1. **`vitest.config.ts`** — create from `templates/vitest-coverage/vitest.config.ts`, **member-scoped**: Vitest resolves its config from the cwd, so each member gets its own copy and its `coverage.include` globs (`src/**/*.ts`) resolve against the member. In a single-package repo the member entry collapses to the root. Vitest's built-in `coverage.thresholds` replaces the Bun recipe's `scripts/coverage-gate.ts`: `perFile: true` with `lines: 100` and `functions: 100` fails the run on any file below the threshold, which is exactly what the hand-written gate did. Two settings are load-bearing:
   - **`coverage.include`** — without it, a file no test imports vanishes from the denominator and the gate passes on an untested file. `src/**/*.ts` is the convention; a project whose source is not under `src/` must widen it.
   - **`coverage.exclude: ["**/*-bin.ts"]`** — a thin process entrypoint that only ever runs as a subprocess is never executed in-process, so it can never reach 100%. A project with such a file must add its own pattern.
   The provider is `istanbul`, not the default `v8`: the v8 provider does not work on non-V8 runtimes, and istanbul's `json` reporter writes `coverage/coverage-final.json`, which is what `fallow-audit-npm` consumes. The Bun recipe's `scripts/lcov-to-istanbul.ts` bridge is therefore not needed here.
2. **`package.json`** — two merges from two templates. **Root** (`templates/vitest-coverage/package.json`): the aggregate `test` script and the `vitest` and `@vitest/coverage-istanbul` devDependencies. Vitest has no "sweep the tree" mode, so the root script fans out to the members — `pnpm -r test` under pnpm, `npm run test --workspaces --if-present` under npm — and falls back to a plain `vitest run --coverage` in a single-package repo, where neither fan-out verb applies. The lockfile and the root manifest's `workspaces` field are the same evidence the detector used to name the manager and the shape, so the script never disagrees with the plan. **Member** (`templates/vitest-coverage/package.member.json`): each member's own `test` script, `vitest run --coverage`. `npm run` resolves a script from the nearest `package.json` only — it does not walk up past a member's own manifest — so without this script the per-member verify dies with `Missing script: "test"`. The member needs no devDependencies of its own: `vitest` is hoisted to the root `node_modules`, and `npm run` puts the root `.bin` on the script's `PATH`. A project that already has a `test` script with a different value is a collision the plan must show.
3. **`.husky/pre-commit`** — merge from `templates/vitest-coverage/pre-commit.block`, inside this recipe's marker pair. The hook runs at the workspace root, where the root `test` script (step 2) fans out to every member.
4. **`.gitignore`** — merge from `templates/vitest-coverage/gitignore.block`, inside this recipe's marker pair: `coverage/`. The pattern is unanchored, so it also ignores a member's `packages/a/coverage/`.
5. **The install** — `sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'`, installing the two devDependencies.

The gate is a wall, not a slope: on a repo that is not already at 100% per file, `npm run test` fails and lists the files. That is the gate working. The recipe's files are correct, the plan shows the gap before applying, and the recipe stays unrecorded until the project climbs to 100%. In a workspace the wall is per member: `verify` runs the gate once per member, so a member below 100% fails on its own and the others still pass.

## Idempotency

- `vitest.config.ts` is a `create`, per member: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `package.json` is a `merge` at the root and per member: re-running re-adds only missing keys; a differing `test` script is a collision the plan must show.
- `.husky/pre-commit` and `.gitignore` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Delete `vitest.config.ts` in each member.
- Remove the `vitest` and `@vitest/coverage-istanbul` devDependencies and the root `test` script from `package.json` — only where this recipe added them.
- Remove the `test` script from the member `package.json` in a workspace — only where this recipe added it.
- Remove the `code-quality:vitest-coverage` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- Remove the `code-quality:vitest-coverage` block from `.gitignore`; delete the file if the block is all it holds.
- Delete `coverage/` at the root and in each member.
- Run the project's install to drop the packages.
