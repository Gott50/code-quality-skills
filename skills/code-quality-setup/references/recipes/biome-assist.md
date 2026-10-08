---
id: biome-assist
title: Biome format and assist, wired to pre-commit
purpose: Format and sort TypeScript with Biome (linter off), applied to staged files on every commit.
when:
  language: [typescript, javascript]
  packageManager: [bun]
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
    template: templates/biome-assist/pre-commit.block
commands:
  - run: bun install
    scope: root
    showInPlan: false
  - run: bunx @biomejs/biome check --write --unsafe --linter-enabled=false .
    scope: root
    showInPlan: true
gates:
  - id: format-check
    run: bun run format:check
    description: Biome format and assist, linter off
verify:
  - gate: format-check
    scope: root
---

## Apply

1. **`biome.json`** — create from `templates/biome-assist/biome.json`. Assist is enabled action-by-action: `assist.enabled: true` alone turns on only the *recommended* actions (in practice just `organizeImports`), so every sorting action is named `"on"` explicitly. The linter stays off (`linter.enabled: false`) because oxlint owns linting; `formatter.enabled: true`. The template is already key-sorted, because the gate it installs sorts keys: an unsorted template is rewritten by the first sweep and then reads as permanent drift.
2. **Workspace member `biome.json`** — create from `templates/biome-assist/biome.member.json`. Without `root: false` and `extends: ["//"]` a nested config becomes its own root and the root run silently stops covering that package. Skipped in a single-package repo, where the root entry writes the same path.
3. **`package.json`** — merge from `templates/biome-assist/package.json`: add the `@biomejs/biome` and `husky` devDependencies, the `format:check` script, and `prepare: husky`. Existing keys are never overwritten; a differing value is a collision the plan must show.
4. **`.husky/pre-commit`** — merge from `templates/biome-assist/pre-commit.block`, inside this recipe's marker pair. The re-stage is `git add -u`, not a bare `git add`: with no pathspec, modern git prints "Nothing specified, nothing added", exits **0**, and stages nothing, so `|| exit 1` never fires and the formatted content silently never reaches the commit.
5. **`bun install`** — installs the two dependencies and runs `prepare`, which installs the hook.
6. **The one-time sweep** — `bunx @biomejs/biome check --write --unsafe --linter-enabled=false .`. Turning a formatter on makes every previously unformatted file a failure, including files this recipe never wrote, so `verify` cannot pass until the repo is swept once. The plan must show this step as *reformats existing files*.

`--unsafe` is a CLI-time flag only (there is no config toggle); the sole unsafe action in this set is the GraphQL `useSortedSelectionSet`.

## Idempotency

- `biome.json` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `package.json` and `.husky/pre-commit` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.
- The sweep is idempotent by construction: a second run finds nothing to fix. The hook is safe to run repeatedly: `--no-errors-on-unmatched` exits 0 when nothing is staged, and assist actions are behaviour-preserving sorting.

## Undo

- Delete `biome.json` (and the member `biome.json` in a workspace).
- Remove the `@biomejs/biome` and `husky` devDependencies, the `format:check` script, and `prepare` from `package.json` — only where this recipe added them.
- Remove the `code-quality:biome-assist` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- `bun install` to drop the packages and the hook. The sweep is not reversible: the formatted files stay formatted.
