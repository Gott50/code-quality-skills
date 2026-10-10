---
id: fallow-audit
title: Dead-code and repo-health audit with fallow
purpose: Audit unused files, exports and types, and score maintainability and CRAP risk against measured coverage.
when:
  language: [typescript, javascript]
  packageManager: [bun]
  workspace: any
  requires: [{ file: package.json }, { recipe: bun-test-coverage }]
cost: fast
priority: 25
files:
  - path: .fallowrc.json
    action: create
    scope: root
    template: templates/fallow-audit/.fallowrc.json
  - path: scripts/lcov-to-istanbul.ts
    action: create
    scope: root
    template: templates/fallow-audit/scripts/lcov-to-istanbul.ts
  - path: package.json
    action: merge
    scope: root
    template: templates/fallow-audit/package.json
  - path: .husky/pre-push
    action: merge
    scope: root
    template: templates/fallow-audit/pre-push.block
commands:
  - run: bun install
    scope: root
    showInPlan: false
gates:
  - id: fallow-audit
    run: bun run fallow:audit
    description: dead code, unused exports and unresolved imports — new issues only
  - id: fallow-health
    run: bun run fallow
    description: maintainability and CRAP risk against measured coverage
verify:
  - gate: fallow-audit
    scope: root
---

## Apply

1. **`.fallowrc.json`** — create from `templates/fallow-audit/.fallowrc.json`. `audit.gate: new-only` is what makes the audit usable on a repo with existing debt: it fails on issues the change *introduces*, not on the ones already there. `entry` names `stryker.conf.mjs`, which is referenced only by the Stryker CLI and would otherwise be reported as an unused file. `ignorePatterns` keeps `scripts/` and `tools/` out of the audit — the vendored oxlint plugin is not the project's code. `ignoreDependencies` names `@oxlint/plugins`, which the ignored plugin imports.
2. **`scripts/lcov-to-istanbul.ts`** — create from `templates/fallow-audit/scripts/lcov-to-istanbul.ts`. bun's coverage reporter emits only `text` and `lcov`, and fallow's `--coverage` needs Istanbul `coverage-final.json`. bun's lcov carries line hits but no per-function records, so the script scans each source file for function declarations to build the function map and marks a function covered when every line of its body is hit. Under the 100% line gate every function ends up covered, so the CRAP scores reflect measured coverage rather than fallow's static estimate.
3. **`package.json`** — merge from `templates/fallow-audit/package.json`: add the `fallow` devDependency and the `fallow`, `fallow:audit` and `fallow:coverage` scripts.
4. **`.husky/pre-push`** — merge from `templates/fallow-audit/pre-push.block`, inside this recipe's marker pair.
5. **`bun install`** — installs `fallow`.

This recipe requires the `bun-test-coverage` recipe: `fallow:coverage` runs `bun run test` and then converts the lcov it produces, so without that recipe there is no coverage to score against. The detector reports the missing requirement as the failing reason rather than applying a half-wired audit.

`fallow:audit` is the gate; `fallow` (health) is a report, not a gate — the script passes `--report-only`, so it prints maintainability and CRAP risk and always exits 0. The CI workflow runs it with `continue-on-error`, so a health regression never fails a build. The health *gate* is the ratchet's `--baseline` invocation, a separate command: `--min-score` must never be combined with `--baseline` in one invocation, because `--min-score` replaces the finding-driven exit code and would silently defeat the baseline.

## Idempotency

- `.fallowrc.json` and `scripts/lcov-to-istanbul.ts` are `create`s: byte-identical on re-run, so they are no-ops. A local edit shows as drift and is reported, not overwritten.
- `package.json` and `.husky/pre-push` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Delete `.fallowrc.json`.
- Delete `scripts/lcov-to-istanbul.ts`; delete `scripts/` if it is empty.
- Remove the `fallow` devDependency and the `fallow`, `fallow:audit` and `fallow:coverage` scripts from `package.json` — only where this recipe added them.
- Remove the `code-quality:fallow-audit` block from `.husky/pre-push`; delete the file if the block is all it holds.
- `bun install` to drop the package.
