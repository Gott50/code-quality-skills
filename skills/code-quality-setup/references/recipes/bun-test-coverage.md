---
id: bun-test-coverage
title: bun test with a per-file coverage gate floored by the baseline
purpose: Run the test suite under bun and fail the build when any file is below its recorded line or function coverage floor (100% with no baseline).
when:
  language: [typescript, javascript]
  packageManager: [bun]
  workspace: any
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
    scope: member
    memberMode: standalone
    template: templates/bun-test-coverage/bunfig.toml
  - path: package.json
    action: merge
    scope: root
    template: templates/bun-test-coverage/package.json
  - path: package.json
    action: merge
    scope: member
    memberMode: standalone
    template: templates/bun-test-coverage/package.member.json
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
    description: bun test with the per-file lines-and-functions coverage floor from the baseline
    floor: coverage
verify:
  - gate: test
    scope: each-member
---

## Apply

1. **`scripts/coverage-gate.ts`** — create from `templates/bun-test-coverage/scripts/coverage-gate.ts`, **root-shared**: one copy at the workspace root, and every member's `test` script names it through `{{root}}` (step 3). The script is cwd-agnostic — it takes `--lcov` and `--baseline` and resolves both from its own process cwd — so a member runs it without a copy of its own, and one script is one source of truth instead of N copies that can drift. It reads bun's lcov output and `.code-quality-baseline.json` and fails listing every file below its floor on **either** line or function coverage: the file's own exact `{hit, found}` fraction if the baseline records it, `gates.coverage.global` if it does not, cross-multiplied so no float rounding creeps in. The global fraction over the whole project is `score.mjs`'s comparison, not the gate's — a member's own run aggregates the member alone, and holding it to the workspace-wide fraction would fail a member exactly at its recorded floor. bun's own `coverageThreshold` is global, which is why the per-file gate is a script.
2. **`bunfig.toml`** — a `patch`, not a `merge`: the target is TOML, and a marker block carrying its own `[test]` header would duplicate a table the project may already declare. **Member-scoped, `standalone`**: bun has no projects concept, so a per-directory `bunfig.toml` is the only per-package knob — a root run sweeps every package, so the coverage settings cannot live at the root. Each member gets its own `[test]` table; in a single-package repo the member entry collapses to the root. The before/after is exact — **before**: no `[test]` table, or a `[test]` table without `coveragePathIgnorePatterns`; **after**: `[test]` declares `coverage = true` and `coveragePathIgnorePatterns = ["**/tmp/**", "**/*-bin.ts"]`. A missing `bunfig.toml` is created from the template. The detector cannot verify a `patch`, so the plan always shows it.
3. **`package.json`** — two merges from two templates. **Root** (`templates/bun-test-coverage/package.json`): the real script, `bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage && bun scripts/coverage-gate.ts --lcov coverage/lcov.info --baseline .code-quality-baseline.json`. In a workspace the root run sweeps every member — bun has no projects concept, so `bun test` at the root recursively searches the whole tree — and that aggregate run is what the root-scoped `.husky/pre-commit` hook and `fallow-audit`'s root `bun run test` execute. **Member** (`templates/bun-test-coverage/package.member.json`): each member's own `test` script, `bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage && bun {{root}}/scripts/coverage-gate.ts --lcov coverage/lcov.info --baseline {{root}}/.code-quality-baseline.json` — the baseline lives at the workspace root, so the member names it through `{{root}}` too.
4. **`.husky/pre-commit`** — merge from `templates/bun-test-coverage/pre-commit.block`, inside this recipe's marker pair. The hook runs at the workspace root, where the root `test` script (step 3) sweeps every member.
5. **`.gitignore`** — merge from `templates/bun-test-coverage/gitignore.block`, inside this recipe's marker pair: `coverage/`. The pattern is unanchored, so it also ignores a member's `packages/a/coverage/`.
6. **`bun install`** — no new dependency, but the install is what makes the script runnable in a fresh checkout.

`coveragePathIgnorePatterns` is the one setting that cannot move to the command line: bun has no CLI flag for it. It exists for process entrypoints — a thin `import.meta.main` bootstrap that only ever runs as a subprocess, which bun cannot instrument, so it can never reach 100%. A project with such a file must add its own pattern; the template's `**/*-bin.ts` is the convention.

The gate is a ratchet, not a wall: with a committed baseline (raised by the skill's `score.mjs --raise`) a debt-carrying repo passes at its recorded floor and only a drop below it fails; with no baseline every floor is 100%, the greenfield wall — on a repo that is not already there, `bun run test` fails and lists the files. That is the gate working. The recipe's files are correct, the plan shows the gap before applying, and the recipe stays unrecorded until the project climbs to its floor (100% when none is recorded). In a workspace the ratchet is per member: `verify` runs the gate once per member, so a member below its floor fails on its own and the others still pass.

## Idempotency

- `scripts/coverage-gate.ts` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `bunfig.toml` is a `patch`, per member: re-applying to the same before-state is a no-op, and a hand-edited file shows as drift.
- `package.json` is a `merge` at the root and per member: re-running re-adds only missing keys; a differing `test` script is a collision the plan must show.
- `.husky/pre-commit` and `.gitignore` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Delete `scripts/coverage-gate.ts`; delete `scripts/` if it is empty.
- Remove the `[test]` keys this recipe added from each member's `bunfig.toml`; delete the file if the fragment is all it holds.
- Restore the previous `test` script in the root and each member's `package.json` — only where this recipe replaced it.
- Remove the `code-quality:bun-test-coverage` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- Remove the `code-quality:bun-test-coverage` block from `.gitignore`; delete the file if the block is all it holds.
- Delete `coverage/` at the root and in each member.
