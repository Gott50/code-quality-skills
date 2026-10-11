---
id: tsconfig-strict
title: Strict TypeScript
purpose: Turn on the strict compiler options and wire `tsc --noEmit` as the typecheck gate.
when:
  language: [typescript]
  packageManager: [bun]
  workspace: any
  requires: [{ file: package.json }]
cost: fast
priority: 40
files:
  - path: tsconfig.json
    action: merge
    scope: root
    template: templates/tsconfig-strict/tsconfig.json
  - path: tsconfig.json
    action: create
    scope: member
    memberMode: extends-root
    template: templates/tsconfig-strict/tsconfig.member.json
  - path: scripts/typecheck-gate.mjs
    action: create
    scope: root
    template: templates/tsconfig-strict/scripts/typecheck-gate.mjs
  - path: package.json
    action: merge
    scope: member
    template: templates/tsconfig-strict/package.member.json
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
    description: tsc --noEmit under the strict options — the type-error count floored by the baseline
    floor: typecheck
verify:
  - gate: typecheck
    scope: each-member
---

## Apply

1. **`tsconfig.json`** — merge from `templates/tsconfig-strict/tsconfig.json`. The merge is recursive, so the fragment's `compilerOptions` leaves are added to whatever the project already declares and nothing else is touched. The options are the proven set: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `moduleDetection: force`, `moduleResolution: bundler`, `allowImportingTsExtensions`, `noEmit`, `skipLibCheck`, `target`/`lib` ES2022, and `types: ["bun"]`.
2. **Workspace member `tsconfig.json`** — create from `templates/tsconfig-strict/tsconfig.member.json`. A stub that extends the root base through `{{root}}`, the member's path back to the workspace root (`../..` for `packages/a`, `../../..` for `packages/nested/b`), so the `extends` resolves at any depth. It declares its own `exclude` because a member inherits the root's `exclude` resolved relative to the root, which would leave the member's own `node_modules` unexcluded; a member that has its own `tools/` adds it to that list. It declares `include: ["**/*"]` because `files`/`include`/`exclude` are inherited through `extends` resolved relative to the config that declared them: a member inheriting a solution-style root (`files: []` + `references`) would otherwise compile nothing and pass the typecheck gate vacuously. Skipped in a single-package repo, where the root entry writes the same path.
3. **Workspace member `package.json`** — merge from `templates/tsconfig-strict/package.member.json`: add the `typecheck` script. `bun run` resolves a script from the nearest `package.json` only — it does not walk up past a member's own manifest — so without this script the per-member verify dies with `Script not found: typecheck`. The member needs no devDependencies of its own: `typescript` is hoisted to the root `node_modules`, and `bun run` puts the root `.bin` on the script's `PATH`. Skipped in a single-package repo, where the root entry writes the same path.
4. **`scripts/typecheck-gate.mjs`** — create from `templates/tsconfig-strict/scripts/typecheck-gate.mjs`, **root-shared**: one copy at the workspace root, and each member's `typecheck` script names it through `{{root}}` (step 3). The typecheck floor: the gate runs `tsc --noEmit --pretty false`, counts the diagnostics (the `: error TS\d+` lines — the same count `score.mjs` reads), and fails when the count exceeds `gates.typecheck.global` from `.code-quality-baseline.json` (written by the skill's `score.mjs --raise`). With no baseline the floor is 0 — any type error fails, the greenfield wall — so a repo that never raised one is gated exactly as before. It is plain `.mjs` so the same script serves every package manager; only the `typecheck` script's runner differs (`bun` here, `node` in the npm variant).
5. **`package.json`** — merge from `templates/tsconfig-strict/package.json`: add the `typescript` and `@types/bun` devDependencies and the `typecheck` script, `bun scripts/typecheck-gate.mjs`.
6. **`.husky/pre-commit`** — merge from `templates/tsconfig-strict/pre-commit.block`, inside this recipe's marker pair.
7. **`bun install`** — installs the two devDependencies.

Two things the fragment deliberately does not name, and why:

- **`include` at the root.** A hardcoded root `include` silently misses a project whose source lives outside it (`app/`, `lib/`, a root-level `index.ts`). The root fragment leaves `include` alone, so `tsc` keeps its default: every TypeScript file under the root except `node_modules`. The member stub names the same default explicitly only to override a solution-style root's `files: []` (step 2).
- **`exclude` is `["node_modules", "tools"]`.** `tools/` holds the vendored oxlint plugin, which does not typecheck under these options (`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` flag it). `exclude` only applies when the project has no `include` of its own: **a project that declares `include` must add `tools` to it, or the plugin is typechecked and the gate fails.** If the project already declares `exclude`, the plan shows the collision — keep the project's list and add `tools` to it rather than accepting the replacement.

`tsc --noEmit` on a repo already below its recorded floor fails. That is the gate working, not a broken recipe: the recipe's files are correct, and the adoption flow writes the baseline at the level the gate measures, so the recipe is recorded on day one — the plan's Measurement section shows the level, the apply runs the gate and then `score.mjs --raise` writes the floor at it, and the verify passes. A repo that never raised a baseline is gated exactly as before — 0 type errors, the wall. In a workspace the gate is per member: `verify` runs it once per member, so a member below its floor fails on its own and the others still pass.

## Idempotency

- `tsconfig.json` is a recursive `merge`: re-running re-adds only missing leaves and reports a changed leaf as a collision. A hand-edited option is never silently overwritten.
- The member `tsconfig.json` is a `create`: byte-identical on re-run, so it is a no-op; a local edit shows as drift and is reported, not overwritten.
- The member `package.json` is a `merge`: re-running re-adds only missing keys and reports a changed value as a collision.
- `package.json` and `.husky/pre-commit` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Remove the `compilerOptions` leaves this recipe added from `tsconfig.json`; delete the file if the fragment is all it holds.
- Delete `scripts/typecheck-gate.mjs`; delete `scripts/` if it is empty.
- Delete the member `tsconfig.json` in a workspace.
- Remove the `typecheck` script from the member `package.json` in a workspace — only where this recipe added it.
- Remove the `typescript` and `@types/bun` devDependencies and the `typecheck` script from `package.json` — only where this recipe added them.
- Remove the `code-quality:tsconfig-strict` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- `bun install` to drop the packages.
