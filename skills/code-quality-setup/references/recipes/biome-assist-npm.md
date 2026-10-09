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
  - run: sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'
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
2. **Workspace member `biome.json`** — create from `templates/biome-assist/biome.member.json`. Without `root: false` and `extends: "//"` a nested config becomes its own root and the root run silently stops covering that package. The microsyntax is the bare string `"//"`; the array form `["//"]` is resolved as a *path* and Biome refuses to load the config ("Could not resolve //"), so the sweep never runs. Skipped in a single-package repo, where the root entry writes the same path.
3. **`package.json`** — merge from `templates/biome-assist/package.json`: add the `@biomejs/biome` devDependency and the `format:check` script. `husky` and `prepare: husky` are the `repo-hygiene-npm` recipe's, not this one's.
4. **`.husky/pre-commit`** — merge from `templates/biome-assist-npm/pre-commit.block`, inside this recipe's marker pair. The block is the Bun recipe's with `bunx` → `npx`. It opens with the same guard: `git status --short | grep -qE '^[^ ?][^ ?]'` refuses the commit when any file shows a non-empty character in **both** the index and worktree columns (`MM`, `AM`), because Biome's `--staged --write` rewrites the worktree and re-staging a file that also has unstaged changes would commit a blend of reviewed and unreviewed content. Untracked (`??`) and clean files do not trip it. The re-stage is `git update-index --again`, which re-adds only the paths already in the index and never sweeps in unstaged hunks — `git add -u` would stage the whole file. It is not a bare `git add` either, which with no pathspec prints "Nothing specified, nothing added", exits **0**, and stages nothing.

   The guard is inlined rather than shipped as a `scripts/biome-staged.ts` template. The two recipes cannot share a marker block (a block's marker must name its owning recipe), so a script would not remove the duplication; it would add a per-manager invocation (`bun` vs `npx tsx`) and a `tsx` devDependency this variant would have to install and the hook resolve. The guard is three lines of POSIX `sh` and the hook already runs under `sh`, so inlining keeps the hook self-contained and dependency-free.
5. **`.gitignore`** — merge from `templates/biome-assist-npm/gitignore.block`, inside this recipe's marker pair: `node_modules/` and `.code-quality.json`. The manifest is the skill's own artifact, written after the verify phase, so the project's gates must not check it. The block is duplicated from the Bun recipe rather than shared, because a marker block must name the recipe that owns it.
6. **The install** — `sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'`. The contract's `run` is a literal command line and the two managers have no common install verb, so the recipe picks by the lockfile the detector already used to name the manager.
7. **The one-time sweep** — `npx @biomejs/biome check --write --unsafe --linter-enabled=false .`. Turning a formatter on makes every previously unformatted file a failure, including files this recipe never wrote, so `verify` cannot pass until the repo is swept once. The plan must show this step as *reformats existing files*. It is a `commands` entry, so it runs in the commands phase — after **every** selected recipe's files are written, not only this one's (RECIPE-CONTRACT.md → Apply order). That is what lets it sort the `package.json` merges of the recipes applied after it (e.g. `oxlint-anti-slop-npm`, `tsconfig-strict-npm`, `vitest-coverage`, `stryker-mutation-vitest`, `fallow-audit-npm`); a sweep confined to this recipe's own apply would leave the merged manifest unsorted and this recipe's own `format:check` `verify` would fail.

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
