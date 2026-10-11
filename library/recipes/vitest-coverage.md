---
id: vitest-coverage
title: Vitest with a per-file coverage gate floored by the baseline (npm/pnpm)
purpose: Run the test suite under Vitest and fail the build when any file is below its recorded statement or function coverage floor (100% with no baseline).
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
  - path: scripts/coverage-gate.mjs
    action: create
    scope: root
    template: templates/vitest-coverage/scripts/coverage-gate.mjs
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
    description: vitest run with the per-file statements-and-functions coverage floor from the baseline
    floor: coverage
verify:
  - gate: test
    scope: each-member
---

## Apply

1. **`vitest.config.ts`** — create from `templates/vitest-coverage/vitest.config.ts`, **member-scoped**: Vitest resolves its config from the cwd, so each member gets its own copy and its `coverage.include` globs (`src/**/*.ts`) resolve against the member. In a single-package repo the member entry collapses to the root. Its `coverage.thresholds` is **global only, on `statements`** — the metric the baseline records (istanbul's `s` map) — read from `gates.coverage.global.statements` in `.code-quality-baseline.json` at load time (rounded down to a whole percentage, so the threshold is never stricter than the recorded floor; 100 with no baseline). The threshold applies only where the config sits beside the baseline — the single-package repo, whose run is the whole workspace; a workspace member's run aggregates the member alone, so a member config disables the threshold and leaves the floors to the gate script. `lines` is deliberately not floored: it has a different denominator (a line with two statements counts once), so flooring it with the statement fraction fails a project exactly at its floor; and a per-file threshold here would apply the global fraction to every file, stricter than the baseline's own per-file floors. The per-file floors are `scripts/coverage-gate.mjs`'s (step 1b), which the `test` script runs after vitest. Two settings are load-bearing:
   - **`coverage.include`** — without it, a file no test imports vanishes from the denominator and the gate passes on an untested file. `src/**/*.ts` is the convention; a project whose source is not under `src/` must widen it.
   - **`coverage.exclude: ["**/*-bin.ts"]`** — a thin process entrypoint that only ever runs as a subprocess is never executed in-process, so it can never reach 100%. A project with such a file must add its own pattern.
   The provider is `istanbul`, not the default `v8`: the v8 provider does not work on non-V8 runtimes, and istanbul's `json` reporter writes `coverage/coverage-final.json`, which is what `fallow-audit-npm` consumes. The Bun recipe's `scripts/lcov-to-istanbul.ts` bridge is therefore not needed here.
1b. **`scripts/coverage-gate.mjs`** — create from `templates/vitest-coverage/scripts/coverage-gate.mjs`, **root-shared**: one copy at the workspace root, and every member's `test` script names it through `{{root}}` (step 2). It is the Vitest twin of the Bun recipe's `scripts/coverage-gate.ts` — the same floors, read from Istanbul's `coverage/coverage-final.json` (statements and functions) instead of bun's lcov — and it is plain `.mjs` so `node` runs it without a TypeScript loader. It fails listing every file below its floor on **either** statement or function coverage: the file's own exact `{hit, found}` fraction **per metric** (`statements` from the `s` map, `functions` from the `f` map) if the baseline records it, `gates.coverage.global` if it does not, each metric against its own floor, cross-multiplied so no float rounding creeps in. The global fraction over the whole project is `score.mjs`'s comparison, not the gate's — a member's own run aggregates the member alone.
2. **`package.json`** — two merges from two templates. **Root** (`templates/vitest-coverage/package.json`): the aggregate `test` script and the `vitest` and `@vitest/coverage-istanbul` devDependencies. Vitest has no "sweep the tree" mode, so the root script fans out to the members — `pnpm -r test` under pnpm, `npm run test --workspaces --if-present` under npm — and falls back to a plain `vitest run --coverage && node scripts/coverage-gate.mjs --baseline .code-quality-baseline.json` in a single-package repo, where neither fan-out verb applies. The lockfile and the root manifest's `workspaces` field are the same evidence the detector used to name the manager and the shape, so the script never disagrees with the plan. **Member** (`templates/vitest-coverage/package.member.json`): each member's own `test` script, `vitest run --coverage && node {{root}}/scripts/coverage-gate.mjs --baseline {{root}}/.code-quality-baseline.json` — the baseline lives at the workspace root, so the member names both the script and the baseline through `{{root}}`.
3. **`.husky/pre-commit`** — merge from `templates/vitest-coverage/pre-commit.block`, inside this recipe's marker pair. The hook runs at the workspace root, where the root `test` script (step 2) fans out to every member.
4. **`.gitignore`** — merge from `templates/vitest-coverage/gitignore.block`, inside this recipe's marker pair: `coverage/`. The pattern is unanchored, so it also ignores a member's `packages/a/coverage/`.
5. **The install** — `sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'`, installing the two devDependencies.

The gate is a ratchet, not a wall: with a committed baseline (raised by the skill's `score.mjs --raise`) a debt-carrying repo passes at its recorded floor and only a drop below it fails; with no baseline every floor is 100%, the greenfield wall. The adoption flow writes the baseline at the level the gate measures, so the recipe is recorded on day one: the plan's Measurement section shows the level, the apply runs the gate and then `score.mjs --raise` writes the floor at it, and the verify passes. A repo that never raised a baseline is gated exactly as before — the wall. In a workspace the ratchet is per member: `verify` runs the gate once per member, so a member below its floor fails on its own and the others still pass.

## Idempotency

- `vitest.config.ts` is a `create`, per member: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `scripts/coverage-gate.mjs` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `package.json` is a `merge` at the root and per member: re-running re-adds only missing keys; a differing `test` script is a collision the plan must show.
- `.husky/pre-commit` and `.gitignore` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Delete `vitest.config.ts` in each member.
- Delete `scripts/coverage-gate.mjs`; delete `scripts/` if it is empty.
- Remove the `vitest` and `@vitest/coverage-istanbul` devDependencies and the root `test` script from `package.json` — only where this recipe added them.
- Remove the `test` script from the member `package.json` in a workspace — only where this recipe added it.
- Remove the `code-quality:vitest-coverage` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- Remove the `code-quality:vitest-coverage` block from `.gitignore`; delete the file if the block is all it holds.
- Delete `coverage/` at the root and in each member.
- Run the project's install to drop the packages.
