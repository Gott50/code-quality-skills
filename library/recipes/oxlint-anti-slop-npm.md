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
  - path: tools/oxlint/anti-slop/rules/max-expects-per-test.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/max-expects-per-test.ts
  - path: tools/oxlint/anti-slop/rules/no-chained-type-assertions.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-chained-type-assertions.ts
  - path: tools/oxlint/anti-slop/rules/no-conditional-empty-object-spread.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-conditional-empty-object-spread.ts
  - path: tools/oxlint/anti-slop/rules/no-conditional-expect.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-conditional-expect.ts
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
  - path: tools/oxlint/anti-slop/rules/no-standalone-expect.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-standalone-expect.ts
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
  - path: tools/oxlint/anti-slop/rules/require-assertion-in-test.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/require-assertion-in-test.ts
  - path: tools/oxlint/anti-slop/rules/require-preserve-on-coverage-ignore.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/require-preserve-on-coverage-ignore.ts
  - path: tools/oxlint/anti-slop/rules/require-safety-comment-for-type-assertion.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/require-safety-comment-for-type-assertion.ts
  - path: tools/oxlint/anti-slop/rules/valid-test-title.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/valid-test-title.ts
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
  - path: tools/oxlint/anti-slop/shared/test-framework.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/shared/test-framework.ts
  - path: scripts/lint-gate.mjs
    action: create
    scope: root
    template: templates/oxlint-anti-slop/scripts/lint-gate.mjs
  - path: package.json
    action: merge
    scope: root
    template: templates/oxlint-anti-slop-npm/package.json
  - path: .husky/pre-commit
    action: merge
    scope: root
    template: templates/oxlint-anti-slop-npm/pre-commit.block
  - path: .husky/pre-push
    action: merge
    scope: root
    template: templates/oxlint-anti-slop-npm/pre-push.block
commands:
  - run: sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'
    scope: root
    showInPlan: false
gates:
  - id: lint
    run: npm run lint
    description: oxlint, including the anti-slop rules — the diagnostic count floored by the baseline
    floor: lint
verify:
  - gate: lint
    scope: root
---

## Apply

1. **`oxlint.config.ts`** — create from `templates/oxlint-anti-slop/oxlint.config.ts`, the same config the Bun recipe writes. oxlint has been Node-based since v1.17 (the npm bin is `#!/usr/bin/env node` and JS plugins load through `await import(url)`), so the config and the plugin are package-manager-neutral and the two recipes share one template. It registers the vendored plugin and turns on its 15 rules plus the size and complexity caps and the core `no-unused-vars` rule at `error`, plus the built-in `typescript/ban-ts-comment`, `typescript/no-explicit-any`, and `typescript/no-unsafe-function-type` rules; `no-unused-vars` catches the in-file unused bindings the compiler options miss (`.d.ts`, `.astro`, `.svelte`, `.vue`), so it pairs with `noUnusedLocals`/`noUnusedParameters` rather than replacing them. Test files are exempted from the line and statement caps through `overrides`.
2. **`tools/oxlint/anti-slop/**`** — create the 19 vendored files. The plugin is self-contained: it imports only `@oxlint/plugins` and its own siblings. `effect/` is deliberately not vendored.
3. **`scripts/lint-gate.mjs`** — create from `templates/oxlint-anti-slop/scripts/lint-gate.mjs`, the same script the Bun recipe writes (root-scoped). The lint floor: the gate runs oxlint with `--report-unused-disable-directives --format json`, counts the diagnostics, and fails when the count exceeds `gates.lint.global` from `.code-quality-baseline.json` (written by the skill's `score.mjs --raise`). With no baseline the floor is 0 — any diagnostic fails, the greenfield wall. It is plain `.mjs`, so `node` runs it without a TypeScript loader.
4. **`package.json`** — merge from `templates/oxlint-anti-slop-npm/package.json`: add the `oxlint` and `@oxlint/plugins` devDependencies and the `lint` script, `node scripts/lint-gate.mjs` — the npm twin of the Bun recipe's `bun scripts/lint-gate.mjs`, one script through two runners — plus the `lint:fix` script, `oxlint --fix .`. Existing keys are never overwritten; a differing value is a collision the plan must show.
5. **`.husky/pre-commit`** — merge from `templates/oxlint-anti-slop-npm/pre-commit.block`, inside this recipe's marker pair. The block is the Bun recipe's with `bun run lint` → `npm run lint`; the hook is inert until `repo-hygiene-npm` wires `prepare`.

   The same gate is merged into **`.husky/pre-push`** from `templates/oxlint-anti-slop-npm/pre-push.block`, inside the same marker pair: a commit made with `--no-verify` skips the pre-commit hook, so the push re-runs the lint gate (`npm run lint`) before the change leaves the machine. The pre-push block closes stdin, which carries the pushed refs the mutation gate reads.
6. **The install** — `sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'`, installing the two devDependencies.
7. **The fixer is a script, not a `commands` entry** — `npm run lint:fix` (`oxlint --fix .`). A `commands` entry would run in the commands phase *after* `biome-assist-npm`'s one-time formatter sweep (priority 50 against this recipe's 45), and a fix that changes layout would leave the file unformatted for `format:check` to fail on — the exact fragility RECIPE-CONTRACT.md → Apply order exists to prevent. A `package.json` script is not a phase participant, so the formatter sweep stays the last command and the project runs the fixer when it chooses. With this config the only fixable rule is `typescript/ban-ts-comment` (it rewrites `// @ts-ignore` to `// @ts-expect-error`); `no-unused-vars` and the anti-slop rules carry no fixer.

Two gotchas the config carries, unchanged from the Bun recipe: **`node_modules/**` is in `ignorePatterns` on purpose** (oxlint lints `node_modules` unless a `.gitignore` excludes it, and a repo that has not run `biome-assist-npm` has no such entry yet), and **`tools/oxlint/anti-slop/**` is in `ignorePatterns`** (the vendored plugin is not the project's code).

`oxlint.config.ts` is TypeScript, loaded by oxlint through Node's type stripping, so the project needs Node >= 22.18 — which is what `repo-hygiene-npm`'s `.node-version` pins.

## Idempotency

- Every `create` is byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `package.json`, `.husky/pre-commit` and `.husky/pre-push` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Delete `oxlint.config.ts`.
- Delete `tools/oxlint/anti-slop/`; delete `tools/` if it is empty.
- Delete `scripts/lint-gate.mjs`; delete `scripts/` if it is empty.
- Remove the `oxlint` and `@oxlint/plugins` devDependencies and the `lint` and `lint:fix` scripts from `package.json` — only where this recipe added them.
- Remove the `code-quality:oxlint-anti-slop-npm` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- Remove the `code-quality:oxlint-anti-slop-npm` block from `.husky/pre-push`; delete the file if the block is all it holds.
- Run the project's install to drop the packages.
