---
id: tsconfig-strict
title: Strict TypeScript
purpose: Turn on the strict compiler options and wire `tsc --noEmit` as the typecheck gate.
when:
  language: [typescript]
  packageManager: [bun]
  workspace: single
  requires: [{ file: package.json }]
cost: fast
priority: 40
files:
  - path: tsconfig.json
    action: merge
    scope: root
    template: templates/tsconfig-strict/tsconfig.json
  - path: package.json
    action: merge
    scope: root
    template: templates/tsconfig-strict/package.json
  - path: .husky/pre-commit
    action: merge
    scope: root
    template: templates/tsconfig-strict/pre-commit.block
commands:
  - run: bun install
    scope: root
    showInPlan: false
gates:
  - id: typecheck
    run: bun run typecheck
    description: tsc --noEmit under the strict options
verify:
  - gate: typecheck
    scope: root
---

## Apply

1. **`tsconfig.json`** — merge from `templates/tsconfig-strict/tsconfig.json`. The merge is recursive, so the fragment's `compilerOptions` leaves are added to whatever the project already declares and nothing else is touched. The options are the proven set: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `moduleDetection: force`, `moduleResolution: bundler`, `allowImportingTsExtensions`, `noEmit`, `skipLibCheck`, `target`/`lib` ES2022, and `types: ["bun"]`.
2. **`package.json`** — merge from `templates/tsconfig-strict/package.json`: add the `typescript` and `@types/bun` devDependencies and the `typecheck` script.
3. **`.husky/pre-commit`** — merge from `templates/tsconfig-strict/pre-commit.block`, inside this recipe's marker pair.
4. **`bun install`** — installs the two devDependencies.

Two things the fragment deliberately does not name, and why:

- **`include`.** A hardcoded `include` silently misses a project whose source lives outside it (`app/`, `lib/`, a root-level `index.ts`). The fragment leaves `include` alone, so `tsc` keeps its default: every TypeScript file under the root except `node_modules`.
- **`exclude` is `["node_modules", "tools"]`.** `tools/` holds the vendored oxlint plugin, which does not typecheck under these options (`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` flag it). `exclude` only applies when the project has no `include` of its own: **a project that declares `include` must add `tools` to it, or the plugin is typechecked and the gate fails.** If the project already declares `exclude`, the plan shows the collision — keep the project's list and add `tools` to it rather than accepting the replacement.

`tsc --noEmit` on a repo that already has type errors fails. That is the gate working, not a broken recipe: the recipe's files are correct, and the project has to climb to the gate. The plan shows the gap before applying, and the recipe stays unrecorded until the gate passes.

## Idempotency

- `tsconfig.json` is a recursive `merge`: re-running re-adds only missing leaves and reports a changed leaf as a collision. A hand-edited option is never silently overwritten.
- `package.json` and `.husky/pre-commit` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Remove the `compilerOptions` leaves this recipe added from `tsconfig.json`; delete the file if the fragment is all it holds.
- Remove the `typescript` and `@types/bun` devDependencies and the `typecheck` script from `package.json` — only where this recipe added them.
- Remove the `code-quality:tsconfig-strict` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- `bun install` to drop the packages.
