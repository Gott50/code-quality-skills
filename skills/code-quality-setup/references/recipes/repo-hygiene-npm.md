---
id: repo-hygiene-npm
title: Repo hygiene — Node pin, ignore entries, and the husky prepare hook (npm/pnpm)
purpose: Pin the Node version, ignore build and env artifacts, and wire `prepare` so the git hooks install on every install.
when:
  language: [typescript, javascript]
  packageManager: [npm, pnpm]
  requires: [{ file: package.json }]
cost: fast
priority: 60
files:
  - path: .node-version
    action: create
    scope: root
    template: templates/repo-hygiene-npm/node-version
  - path: .gitignore
    action: merge
    scope: root
    template: templates/repo-hygiene-npm/gitignore.block
  - path: package.json
    action: merge
    scope: root
    template: templates/repo-hygiene/package.json
commands:
  - run: sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'
    scope: root
    showInPlan: false
gates: []
verify:
  - run: test -f .node-version && grep -q "code-quality:repo-hygiene-npm:start" .gitignore && node -e "const p=require('./package.json'); if (p.scripts?.prepare !== 'husky') process.exit(1)"
    scope: root
---

## Apply

1. **`.node-version`** — create from `templates/repo-hygiene-npm/node-version`. `actions/setup-node`'s `node-version-file` reads it, so CI and the local runtime agree. A pnpm project pins pnpm itself through `packageManager` + Corepack, not through this file.
2. **`.gitignore`** — merge from `templates/repo-hygiene-npm/gitignore.block`, inside this recipe's marker pair. The entries are package-manager-neutral and identical to the Bun recipe's, but the block is written twice: a merged block's marker must name the recipe that owns it, so the two siblings cannot share one file.
3. **`package.json`** — merge from `templates/repo-hygiene/package.json`: add the `husky` devDependency and the `prepare: husky` script. `prepare` runs on `npm install`/`npm ci` and on a pnpm full install, so a fresh checkout wires `.husky/` without a manual step. It does **not** run on `pnpm add <pkg>` or under `--ignore-scripts`; a project that installs with `--ignore-scripts` in CI must run `husky` explicitly.
4. **The install** — `sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'`. The contract's `run` is a literal command line and the two managers have no common install verb, so the recipe picks by the lockfile the detector already used to name the manager. It is an `if`/`else` on the lockfile's **existence**, deliberately not the shorter `test -f pnpm-lock.yaml && pnpm install || npm install`: with the `||` form a *failing* `pnpm install` silently falls through to `npm install`, which writes a `package-lock.json` into a pnpm project. pnpm makes that failure realistic — from pnpm 10 it exits non-zero (`ERR_PNPM_IGNORED_BUILDS`) when a dependency's build script is not allowlisted — so a failed pnpm install must never be read as "use npm instead". It installs `husky` and runs `prepare`.

## Idempotency

- `.node-version` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `.gitignore` and `package.json` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys. A `prepare` script with a different value is a collision the plan must show.

## Undo

- Delete `.node-version`.
- Remove the `code-quality:repo-hygiene` block from `.gitignore`; delete the file if the block is all it holds.
- Remove the `husky` devDependency and the `prepare` script from `package.json` — only where this recipe added them.
- Run the project's install to drop the package.
