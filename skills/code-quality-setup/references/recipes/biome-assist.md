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
  - path: .gitignore
    action: merge
    scope: root
    template: templates/biome-assist/gitignore.block
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
2. **Workspace member `biome.json`** — create from `templates/biome-assist/biome.member.json`. Without `root: false` and `extends: "//"` a nested config becomes its own root and the root run silently stops covering that package. The microsyntax is the bare string `"//"`; the array form `["//"]` is resolved as a *path* and Biome refuses to load the config ("Could not resolve //"), so the sweep never runs. Skipped in a single-package repo, where the root entry writes the same path.
3. **`package.json`** — merge from `templates/biome-assist/package.json`: add the `@biomejs/biome` devDependency and the `format:check` script. Existing keys are never overwritten; a differing value is a collision the plan must show. `husky` and `prepare: husky` are the `repo-hygiene` recipe's, not this one's: it runs first and owns the hook installer, so this recipe only writes the hook body.
4. **`.husky/pre-commit`** — merge from `templates/biome-assist/pre-commit.block`, inside this recipe's marker pair. The block opens with a guard: `git status --short | grep -qE '^[^ ?][^ ?]'` refuses the commit when any file shows a non-empty character in **both** the index and worktree columns (`MM`, `AM`). Biome's `--staged --write` rewrites the worktree, so re-staging a file that also has unstaged changes would commit a blend of reviewed and unreviewed content; the guard fails loudly instead. Untracked (`??`) and clean files do not trip it, because the pattern excludes `?` and space in both columns. The re-stage is `git update-index --again`, which re-adds only the paths already in the index (the ones Biome just rewrote) and never sweeps in unstaged hunks — `git add -u` would stage the whole file. It is not a bare `git add` either: with no pathspec, modern git prints "Nothing specified, nothing added", exits **0**, and stages nothing, so `|| exit 1` never fires and the formatted content silently never reaches the commit.

   The guard is inlined rather than shipped as a `scripts/biome-staged.ts` template. The two recipes cannot share a marker block (a block's marker must name its owning recipe), so a script would not remove the duplication; it would add a per-manager invocation (`bun` vs `npx tsx`) and a `tsx` devDependency the npm variant would have to install and the hook resolve. The guard is three lines of POSIX `sh` and the hook already runs under `sh`, so inlining keeps the hook self-contained and dependency-free.
5. **`.gitignore`** — merge from `templates/biome-assist/gitignore.block`, inside this recipe's marker pair: `node_modules/` and `.code-quality.json`. The manifest is the skill's own artifact, written after the verify phase, so the project's gates must not check it. Each recipe owns its own ignore lines, so the block names the recipe that added them and a later recipe's lines sit beside it rather than in one shared list.
6. **`bun install`** — installs the dependency. The hook itself is installed by `repo-hygiene`'s `prepare`.
7. **The one-time sweep** — `bunx @biomejs/biome check --write --unsafe --linter-enabled=false .`. Turning a formatter on makes every previously unformatted file a failure, including files this recipe never wrote, so `verify` cannot pass until the repo is swept once. The plan must show this step as *reformats existing files*. It is a `commands` entry, so it runs in the commands phase — after **every** selected recipe's files are written, not only this one's (RECIPE-CONTRACT.md → Apply order). That is what lets it sort the `package.json` merges of the recipes applied after it (e.g. `oxlint-anti-slop`, `tsconfig-strict`, `bun-test-coverage`, `stryker-mutation`, `fallow-audit`); a sweep confined to this recipe's own apply would leave the merged manifest unsorted and this recipe's own `format:check` `verify` would fail.

`--unsafe` is a CLI-time flag only (there is no config toggle); the sole unsafe action in this set is the GraphQL `useSortedSelectionSet`.

**The sweep's scope is the gate's scope.** `format:check` runs `biome check .`, so the sweep must cover every file the gate checks; narrowing it to this recipe's own files would leave every pre-existing unformatted file failing the gate. The sweep therefore also reformats files this recipe does not own — including a generated JSON lockfile such as `skills-lock.json`, which the repo's own `biome.json` (`useSortedKeys: "on"`) already tells Biome to sort. That is the repo's config being enforced, not a template this recipe wrote: `biome check .` reports the lockfile before the recipe runs. A repo that does not want a generated file reformatted must exclude it in its own `biome.json`; the recipe's template is repo-wide by design, and a repo's own `biome.json` is not the recipe's to change.

## Idempotency

- `biome.json` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `package.json`, `.husky/pre-commit` and `.gitignore` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.
- The sweep is idempotent by construction: a second run finds nothing to fix. The hook is safe to run repeatedly: `--no-errors-on-unmatched` exits 0 when nothing is staged, and assist actions are behaviour-preserving sorting.

## Undo

- Delete `biome.json` (and the member `biome.json` in a workspace).
- Remove the `@biomejs/biome` devDependency and the `format:check` script from `package.json` — only where this recipe added them.
- Remove the `code-quality:biome-assist` block from `.husky/pre-commit`; delete the file if the block is all it holds.
- Remove the `code-quality:biome-assist` block from `.gitignore`; delete the file if the block is all it holds.
- `bun install` to drop the packages and the hook. The sweep is not reversible: the formatted files stay formatted.
