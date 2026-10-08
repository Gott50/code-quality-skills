---
id: oxlint-anti-slop-npm
title: Lint with oxlint and the anti-slop plugin (npm/pnpm)
purpose: Lint TypeScript with oxlint, including the vendored anti-slop rules that reject low-evidence patterns.
when:
  language: [typescript, javascript]
  packageManager: [npm, pnpm]
  workspace: any
  requires: [{ file: package.json }]
conflicts:
  tools: [eslint]
cost: fast
priority: 45
files:
  - path: oxlint.config.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/oxlint.config.ts
  - path: tools/oxlint/anti-slop/index.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/index.ts
  - path: tools/oxlint/anti-slop/rules/no-chained-type-assertions.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-chained-type-assertions.ts
  - path: tools/oxlint/anti-slop/rules/no-conditional-empty-object-spread.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-conditional-empty-object-spread.ts
  - path: tools/oxlint/anti-slop/rules/no-known-value-widening.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-known-value-widening.ts
  - path: tools/oxlint/anti-slop/rules/no-module-mocking.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-module-mocking.ts
  - path: tools/oxlint/anti-slop/rules/no-object-parameters.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-object-parameters.ts
  - path: tools/oxlint/anti-slop/rules/no-reflect-apply.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-reflect-apply.ts
  - path: tools/oxlint/anti-slop/rules/no-reflect-get.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-reflect-get.ts
  - path: tools/oxlint/anti-slop/rules/no-runtime-typeof.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-runtime-typeof.ts
  - path: tools/oxlint/anti-slop/rules/no-shape-in-symbol-names.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-shape-in-symbol-names.ts
  - path: tools/oxlint/anti-slop/rules/no-unknown-parameters.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-unknown-parameters.ts
  - path: tools/oxlint/anti-slop/rules/no-unknown-returns.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-unknown-returns.ts
  - path: tools/oxlint/anti-slop/rules/no-unknown-type-aliases.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-unknown-type-aliases.ts
  - path: tools/oxlint/anti-slop/rules/no-unsafe-dictionary-type.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-unsafe-dictionary-type.ts
  - path: tools/oxlint/anti-slop/rules/no-widen-then-assert.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-widen-then-assert.ts
  - path: tools/oxlint/anti-slop/rules/require-safety-comment-for-type-assertion.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/require-safety-comment-for-type-assertion.ts
  - path: tools/oxlint/anti-slop/shared/dictionary-types.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/shared/dictionary-types.ts
  - path: tools/oxlint/anti-slop/shared/lexical-type-parameters.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/shared/lexical-type-parameters.ts
  - path: tools/oxlint/anti-slop/shared/reflect-method.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/shared/reflect-method.ts
  - path: package.json
    action: merge
    scope: root
    template: templates/oxlint-anti-slop/package.json
  - path: .husky/pre-commit
    action: merge
    scope: root
    template: templates/oxlint-anti-slop-npm/pre-commit.block
commands:
  - run: sh -c 'test -f pnpm-lock.yaml && pnpm install || npm install'
    scope: root
    showInPlan: false
gates:
  - id: lint
    run: npm run lint
    description: oxlint, including the anti-slop rules
verify:
  - gate: lint
    scope: root
---

## Apply

1. **`oxlint.config.ts`** — create from `templates/oxlint-anti-slop/oxlint.config.ts`, the same config the Bun recipe writes. oxlint has been Node-based since v1.17 (the npm bin is `#!/usr/bin/env node` and JS plugins load through `await import(url)`), so the config and the plugin are package-manager-neutral and the two recipes share one template. It registers the vendored plugin and turns on its 15 rules plus the size and complexity caps; test files are exempted from the line and statement caps through `overrides`.
2. **`tools/oxlint/anti-slop/**`** — create the 19 vendored files. The plugin is self-contained: it imports only `@oxlint/plugins` and its own siblings. `effect/` is deliberately not vendored.
3. **`package.json`** — merge from `templates/oxlint-anti-slop/package.json`: add the `oxlint` and `@oxlint/plugins` devDependencies and the `lint` script. Existing keys are never overwritten; a differing value is a collision the plan must show.
4. **`.husky/pre-commit`** — merge from `templates/oxlint-anti-slop-npm/pre-commit.block`, inside this recipe's marker pair. The block is the Bun recipe's with `bun run lint` → `npm run lint`; the hook is inert until `repo-hygiene-npm` wires `prepare`.
5. **The install** — `sh -c 'test -f pnpm-lock.yaml && pnpm install || npm install'`, installing the two devDependencies.

Two gotchas the config carries, unchanged from the Bun recipe: **`node_modules/**` is in `ignorePatterns` on purpose** (oxlint lints `node_modules` unless a `.gitignore` excludes it, and a repo that has not run `biome-assist-npm` has no such entry yet), and **`tools/oxlint/anti-slop/**` is in `ignorePatterns`** (the vendored plugin is not the project's code).

`oxlint.config.ts` is TypeScript, loaded by oxlint through Node's type stripping, so the project needs Node >= 22.18 — which is what `repo-hygiene-npm`'s `.node-version` pins.

## Idempotency

- Every `create` is byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `package.json` and `.husky/pre-commit` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Delete `oxlint.config.ts`.
- Delete `tools/oxlint/anti-slop/`; delete `tools/` if it is empty.
- Remove the `oxlint` and `@oxlint/plugins` devDependencies and the `lint` script from `package.json` — only where this recipe added them.
- Remove the `code-quality:oxlint-anti-slop-npm` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- Run the project's install to drop the packages.
