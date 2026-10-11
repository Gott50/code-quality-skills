---
id: repo-hygiene
title: Repo hygiene — runtime pin, ignore entries, and the husky prepare hook
purpose: Pin the Bun version, ignore build and env artifacts, and wire `prepare` so the git hooks install on every install.
when:
  language: [typescript, javascript]
  packageManager: [bun]
  requires: [{ file: package.json }]
cost: fast
priority: 60
files:
  - path: .bun-version
    action: create
    scope: root
    template: templates/repo-hygiene/bun-version
  - path: .gitignore
    action: merge
    scope: root
    template: templates/repo-hygiene/gitignore.block
  - path: package.json
    action: merge
    scope: root
    template: templates/repo-hygiene/package.json
commands:
  - run: bun install
    scope: root
    showInPlan: false
gates: []
verify:
  - run: test -f .bun-version && grep -q "code-quality:repo-hygiene:start" .gitignore && node -e "const p=require('./package.json'); if (p.scripts?.prepare !== 'husky') process.exit(1)"
    scope: root
---

## Apply

1. **`.bun-version`** — create from `templates/repo-hygiene/bun-version`. The pin is what `oven-sh/setup-bun`'s `bun-version-file` reads in CI, so the workflow and the local runtime agree. A project that already pins its runtime is a `create` drift, reported and applied only on approval.
2. **`.gitignore`** — merge from `templates/repo-hygiene/gitignore.block`, inside this recipe's marker pair. It carries only the entries no other recipe owns (`.npm/`, `dist/`, `*.tsbuildinfo`, `.env`, `.env.local`, `*.log`); `node_modules/`, `coverage/`, `reports/` and `.stryker-tmp/` belong to the recipes that produce them, each under its own marker.
3. **`package.json`** — merge from `templates/repo-hygiene/package.json`: add the `husky` devDependency and the `prepare: husky` script. `prepare` is the hook installer: it runs on `bun install`, so a fresh checkout wires `.husky/` without a manual step. This recipe owns it because it runs first (`priority: 60`), before any recipe that writes a hook block.
4. **`bun install`** — installs `husky` and runs `prepare`, which installs the hooks.

## Idempotency

- `.bun-version` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `.gitignore` and `package.json` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys. A `prepare` script with a different value is a collision the plan must show.

## Undo

- Delete `.bun-version`.
- Remove the `code-quality:repo-hygiene` block from `.gitignore`; delete the file if the block is all it holds.
- Remove the `husky` devDependency and the `prepare` script from `package.json` — only where this recipe added them.
- `bun install` to drop the package.
