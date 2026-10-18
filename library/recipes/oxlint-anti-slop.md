---
id: oxlint-anti-slop
title: Lint with oxlint and the anti-slop plugin
purpose: Lint TypeScript with oxlint, including the vendored anti-slop rules that reject low-evidence patterns.
when:
  language: [typescript, javascript]
  packageManager: [bun]
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
  - path: oxlint.config.ts
    action: create
    scope: member
    memberMode: extends-root
    template: templates/oxlint-anti-slop/oxlint.member.config.ts
  - path: tools/oxlint/anti-slop/index.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/index.ts
  - path: tools/oxlint/anti-slop/rules/max-expects-per-test.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/max-expects-per-test.ts
  - path: tools/oxlint/anti-slop/rules/no-assertion-over-parsed-data.ts
    action: create
    scope: root
    template: templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-assertion-over-parsed-data.ts
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
    template: templates/oxlint-anti-slop/package.json
  - path: .husky/pre-commit
    action: merge
    scope: root
    template: templates/oxlint-anti-slop/pre-commit.block
  - path: .husky/pre-push
    action: merge
    scope: root
    template: templates/oxlint-anti-slop/pre-push.block
commands:
  - run: bun install
    scope: root
    showInPlan: false
gates:
  - id: lint
    run: bun run lint
    description: oxlint, including the anti-slop rules — the diagnostic count floored by the baseline
    floor: lint
verify:
  - gate: lint
    scope: root
---

## Apply

1. **`oxlint.config.ts`** — create from `templates/oxlint-anti-slop/oxlint.config.ts`. It registers the vendored plugin as a JS plugin and turns on its 22 rules plus the size and complexity caps (`max-lines: 400`, `max-lines-per-function: 60`, `max-statements: 20`, `complexity: 10`) and the core `no-unused-vars` rule at `error`, plus the built-in `typescript/ban-ts-comment`, `typescript/no-explicit-any`, and `typescript/no-unsafe-function-type` rules. `no-unused-vars` catches the in-file unused bindings the compiler options miss — `.d.ts`, `.astro`, `.svelte`, and `.vue` files, which `tsc` does not check — so it pairs with `noUnusedLocals`/`noUnusedParameters` rather than replacing them. Test files are exempted from the line and statement caps through `overrides`: they are assertion-heavy, and the caps force coverage-degrading condensation.
2. **Workspace member `oxlint.config.ts`** — create from `templates/oxlint-anti-slop/oxlint.member.config.ts`. A nested config replaces the root config for its subtree rather than merging with it, so the stub inherits the root base by spreading its extendable fields (`rules`, `plugins`, `overrides`) and re-declares `jsPlugins`. It cannot use `extends: [baseConfig]`: oxlint rejects a relative `jsPlugins` specifier in a config reached through `extends` ("Relative JS plugin specifiers are not supported in configs provided via `extends`"), and the root base carries one. The member's own `jsPlugins` specifier resolves relative to the config file, so it names the vendored plugin through `{{root}}`. Skipped in a single-package repo, where the root entry writes the same path.
3. **`tools/oxlint/anti-slop/**`** — create the 27 vendored files. The plugin is self-contained: it imports only `@oxlint/plugins` and its own siblings. `effect/` is deliberately not vendored — the plugin entry registers only the 22 rules under `rules/`, and nothing imports `effect/`.
   One vendored rule is the gate for the decode-at-the-boundary practice: **`no-assertion-over-parsed-data`** flags a type assertion over data parsed from outside the program — `JSON.parse(...) as T`, `await response.json() as T` — because the assertion tells the compiler what the value is without checking it. The fix is a validator at the I/O boundary (`zod`, `valibot`), not a wider assertion; the judgement of where `any` is allowed and where a validator is required is the `decode-at-the-boundary` practice, which the `agent-guidance` recipe delivers alongside the gate.
4. **`scripts/lint-gate.mjs`** — create from `templates/oxlint-anti-slop/scripts/lint-gate.mjs`, **root-scoped**. The lint floor: the gate runs oxlint with `--report-unused-disable-directives --format json`, counts the diagnostics, and fails when the count exceeds `gates.lint.global` from `.code-quality-baseline.json` (written by the skill's `score.mjs --raise`). With no baseline the floor is 0 — any diagnostic fails, the greenfield wall — so a repo that never raised one is gated exactly as before. It is plain `.mjs` so the same script serves every package manager; only the `lint` script's runner differs (`bun` here, `node` in the npm variant).
5. **`package.json`** — merge from `templates/oxlint-anti-slop/package.json`: add the `oxlint` and `@oxlint/plugins` devDependencies and the `lint` script, `bun scripts/lint-gate.mjs`, plus the `lint:fix` script, `oxlint --fix .`. Existing keys are never overwritten; a differing value is a collision the plan must show.
6. **`.husky/pre-commit`** — merge from `templates/oxlint-anti-slop/pre-commit.block`, inside this recipe's marker pair. The hook is inert until `husky` is installed and `prepare` is wired; the `biome-assist` recipe does that, and this recipe's `package.json` fragment does not repeat it.

   The same gate is merged into **`.husky/pre-push`** from `templates/oxlint-anti-slop/pre-push.block`, inside the same marker pair: a commit made with `--no-verify` skips the pre-commit hook, so the push re-runs the lint gate before the change leaves the machine. The pre-push block closes stdin, which carries the pushed refs the mutation gate reads.
7. **`bun install`** — installs the two devDependencies.
8. **The fixer is a script, not a `commands` entry** — `bun run lint:fix` (`oxlint --fix .`). A `commands` entry would run in the commands phase *after* `biome-assist`'s one-time formatter sweep (priority 50 against this recipe's 45), and a fix that changes layout would leave the file unformatted for `format:check` to fail on — the exact fragility RECIPE-CONTRACT.md → Apply order exists to prevent. A `package.json` script is not a phase participant, so the formatter sweep stays the last command and the project runs the fixer when it chooses. With this config the only fixable rule is `typescript/ban-ts-comment` (it rewrites `// @ts-ignore` to `// @ts-expect-error`); `no-unused-vars` and the anti-slop rules carry no fixer.

Two gotchas the config carries:

- **`node_modules/**` is in `ignorePatterns` on purpose.** oxlint lints `node_modules` unless a `.gitignore` excludes it, and a repo that has not run the `biome-assist` recipe has no `.gitignore` entry yet. Without the pattern, `bun run lint` reports thousands of errors from dependencies.
- **`tools/oxlint/anti-slop/**` is in `ignorePatterns`.** The vendored plugin is not the project's code and must not be linted by the rules it defines.

`oxlint.config.ts` is TypeScript, loaded by oxlint through Node's type stripping, so the project needs Node >= 22.18 (or Bun, which strips types natively).

## Idempotency

- Every `create` — the root and member `oxlint.config.ts` and the vendored files alike — is byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `package.json`, `.husky/pre-commit` and `.husky/pre-push` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Delete `oxlint.config.ts` (and the member `oxlint.config.ts` in a workspace).
- Delete `tools/oxlint/anti-slop/`; delete `tools/` if it is empty.
- Delete `scripts/lint-gate.mjs`; delete `scripts/` if it is empty.
- Remove the `oxlint` and `@oxlint/plugins` devDependencies and the `lint` and `lint:fix` scripts from `package.json` — only where this recipe added them.
- Remove the `code-quality:oxlint-anti-slop` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- Remove the `code-quality:oxlint-anti-slop` block from `.husky/pre-push`; delete the file if the block is all it holds.
- `bun install` to drop the packages.
