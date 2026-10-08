---
id: eslint-prettier
title: ESLint and Prettier as the lint and format gates (npm/pnpm)
purpose: Wire an existing ESLint + Prettier setup as the lint and format gates, for a project that already runs them.
when:
  language: [typescript, javascript]
  packageManager: [npm, pnpm]
  workspace: any
  requires: [{ dep: eslint }, { dep: prettier }]
cost: fast
priority: 45
files:
  - path: package.json
    action: merge
    scope: root
    template: templates/eslint-prettier/package.json
  - path: .husky/pre-commit
    action: merge
    scope: root
    template: templates/eslint-prettier/pre-commit.block
commands:
  - run: sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'
    scope: root
    showInPlan: false
gates:
  - id: lint
    run: npm run lint
    description: ESLint over the project
  - id: format-check
    run: npm run format:check
    description: Prettier check
verify:
  - gate: lint
    scope: root
  - gate: format-check
    scope: root
---

## Apply

1. **`package.json`** — merge from `templates/eslint-prettier/package.json`: add the `eslint` and `prettier` devDependencies and the `lint` and `format:check` scripts. Existing keys are never overwritten; a differing value is a collision the plan must show.
2. **`.husky/pre-commit`** — merge from `templates/eslint-prettier/pre-commit.block`, inside this recipe's marker pair.
3. **The install** — `sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'`.

**This recipe writes no ESLint or Prettier config.** The project already has one — that is what its `when` matches on (`{ dep: eslint }`, `{ dep: prettier }`) — and a `create` of a config the project owns would be permanent drift from the first run. The recipe only turns the existing setup into a gate and a pre-commit hook.

`biome-assist-npm` declares `conflicts.recipes: [eslint-prettier]`, so on a project that matches both, the higher-`priority` recipe wins and this one is reported as *held back* — a visible, approvable outcome rather than a silent switch from ESLint + Prettier to Biome. That is the recipe-vs-recipe side of the same question `biome-assist-npm`'s `conflicts.tools` raises from the collision side.

`eslint .` needs a config the installed ESLint reads: ESLint 9 reads flat config (`eslint.config.*`) by default, so a project still on a legacy `.eslintrc` must either migrate or set `ESLINT_USE_FLAT_CONFIG=false` in its `lint` script.

## Idempotency

- `package.json` and `.husky/pre-commit` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Remove the `eslint` and `prettier` devDependencies and the `lint` and `format:check` scripts from `package.json` — only where this recipe added them.
- Remove the `code-quality:eslint-prettier` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- Run the project's install to drop the packages.
