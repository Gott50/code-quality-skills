---
id: biome-assist-npm
title: Biome format and assist, wired to pre-commit (npm/pnpm)
purpose: Format and sort TypeScript with Biome (linter off), applied to staged files on every commit.
when:
  language: [typescript, javascript]
  packageManager: [npm, pnpm]
  workspace: any
  requires: [{ file: package.json }]
conflicts:
  recipes: [eslint-prettier]
  tools: [prettier, eslint]
cost: fast
priority: 50
files:
  - path: biome.json
    action: create
    scope: root
    template: templates/biome-assist/biome.json
  - path: biome.json
    action: create
    scope: member
    memberMode: extends-root
    template: templates/biome-assist/biome.member.json
  - path: package.json
    action: merge
    scope: root
    template: templates/biome-assist/package.json
  - path: .husky/pre-commit
    action: merge
    scope: root
    template: templates/biome-assist-npm/pre-commit.block
  - path: .gitignore
    action: merge
    scope: root
    template: templates/biome-assist-npm/gitignore.block
commands:
  - run: sh -c 'test -f pnpm-lock.yaml && pnpm install || npm install'
    scope: root
    showInPlan: false
  - run: npx @biomejs/biome check --write --unsafe --linter-enabled=false .
    scope: root
    showInPlan: true
gates:
  - id: format-check
    run: npm run format:check
    description: Biome format and assist, linter off
verify:
  - gate: format-check
    scope: root
---

## Apply

1. **`biome.json`** — create from `templates/biome-assist/biome.json`, the same config the Bun recipe writes: Biome's config is package-manager-neutral, so the two recipes share one template. Assist is enabled action-by-action (`assist.enabled: true` alone turns on only the *recommended* actions), the linter stays off because oxlint owns linting, and the template is already key-sorted because the gate it installs sorts keys.
2. **Workspace member `biome.json`** — create from `templates/biome-assist/biome.member.json`. Without `root: false` and `extends: ["//"]` a nested config becomes its own root and the root run silently stops covering that package. Skipped in a single-package repo, where the root entry writes the same path.
3. **`package.json`** — merge from `templates/biome-assist/package.json`: add the `@biomejs/biome` devDependency and the `format:check` script. `husky` and `prepare: husky` are the `repo-hygiene-npm` recipe's, not this one's.
4. **`.husky/pre-commit`** — merge from `templates/biome-assist-npm/pre-commit.block`, inside this recipe's marker pair. The block is the Bun recipe's with `bunx` → `npx`; the re-stage is `git add -u`, not a bare `git add`, which with no pathspec prints "Nothing specified, nothing added", exits **0**, and stages nothing.
5. **`.gitignore`** — merge from `templates/biome-assist-npm/gitignore.block`, inside this recipe's marker pair: `node_modules/`. The block is duplicated from the Bun recipe rather than shared, because a marker block must name the recipe that owns it.
6. **The install** — `sh -c 'test -f pnpm-lock.yaml && pnpm install || npm install'`. The contract's `run` is a literal command line and the two managers have no common install verb, so the recipe picks by the lockfile the detector already used to name the manager.
7. **The one-time sweep** — `npx @biomejs/biome check --write --unsafe --linter-enabled=false .`. Turning a formatter on makes every previously unformatted file a failure, including files this recipe never wrote, so `verify` cannot pass until the repo is swept once. The plan must show this step as *reformats existing files*.

`npx` resolves the project's own `node_modules/.bin` under both npm and pnpm, so the hook and the sweep need no per-manager branch. `--unsafe` is a CLI-time flag only; the sole unsafe action in this set is the GraphQL `useSortedSelectionSet`.

## Idempotency

- `biome.json` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `package.json`, `.husky/pre-commit` and `.gitignore` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.
- The sweep is idempotent by construction: a second run finds nothing to fix. The hook is safe to run repeatedly: `--no-errors-on-unmatched` exits 0 when nothing is staged.

## Undo

- Delete `biome.json` (and the member `biome.json` in a workspace).
- Remove the `@biomejs/biome` devDependency and the `format:check` script from `package.json` — only where this recipe added them.
- Remove the `code-quality:biome-assist-npm` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- Remove the `code-quality:biome-assist-npm` block from `.gitignore`; delete the file if the block is all it holds.
- Run the project's install to drop the package. The sweep is not reversible: the formatted files stay formatted.
