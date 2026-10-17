---
id: dep-graph
title: Dependency graph — no cycles, no deep imports
purpose: Fail on a dependency cycle and on a relative import into another workspace member's internals, with the repo's existing violations recorded in the tool's own baseline.
when:
  requires: [{ file: package.json }]
cost: fast
priority: 15
files:
  - path: .dependency-cruiser.cjs
    action: create
    scope: root
    template: templates/dep-graph/.dependency-cruiser.cjs
  - path: scripts/dep-graph.sh
    action: create
    scope: root
    template: templates/dep-graph/scripts/dep-graph.sh
  - path: package.json
    action: merge
    scope: root
    template: templates/dep-graph/package.json
commands:
  - run: sh -c 'if test -f bun.lock -o -f bun.lockb; then bun install; elif test -f pnpm-lock.yaml; then pnpm install --no-frozen-lockfile; else npm install; fi'
    scope: root
    showInPlan: false
gates:
  - id: dep-graph
    run: sh scripts/dep-graph.sh
    description: dependency-cruiser over the workspace — a cycle, or a relative import into another member's src/, fails; the violations recorded in .dependency-cruiser-known-violations.json pass
verify:
  - gate: dep-graph
    scope: root
---

## Apply

1. **`.dependency-cruiser.cjs`** — create from `templates/dep-graph/.dependency-cruiser.cjs`. Two
   `forbidden` rules, both `error`:
   - **`no-circular`** — `to: { circular: true }`. A cycle makes the two modules one unit: neither
     can be understood, tested or replaced alone, and the import order decides which one wins.
   - **`no-deep-import-into-another-package`** — `from: { path: "^packages/(.+)/src/" }` and
     `to: { path: "^packages/(?!$1/).*/src/", dependencyTypes: ["local"] }`. `$1` is the importing
     member's root, so the rule holds at any member depth (`packages/a` and `packages/nested/b`
     alike) rather than only at the first path segment; the lookahead keeps a member's own relative
     imports legal, and `dependencyTypes: ["local"]` keeps an import by package name legal even
     though it resolves into the same directory. A member is imported by its package name, never by
     a relative path into its `src/`.
   - `options.tsPreCompilationDeps: true` is load-bearing, not a preference. dependency-cruiser
     transpiles TypeScript to JavaScript before parsing it by default, and the transpiler elides an
     import whose binding is unused — so a cycle or a deep import carried by an unused (or
     `import type`) edge would be invisible to the gate. Reading the pre-compilation dependencies
     keeps every edge the source states.
   - `options.exclude` keeps `node_modules`, `dist`, `coverage` and `.stryker-tmp` out of the graph;
     `doNotFollow` stops the traversal at `node_modules` so a dependency's own graph is not cruised.

2. **`scripts/dep-graph.sh`** — create from `templates/dep-graph/scripts/dep-graph.sh`. The gate,
   and the reason this recipe needs no package-manager variant: it runs the local
   `node_modules/.bin/depcruise` directly, so the same command works under Bun, npm and pnpm. It
   passes `--ignore-known .dependency-cruiser-known-violations.json` **only when that file exists**
   (the flag fails on a missing file), and it fails closed on an empty graph: dependency-cruiser
   ships no transpiler of its own, parses TypeScript only when the TypeScript compiler is installed
   beside it, and exits 0 on a graph it cruised nothing into — a repo whose `.ts` files never
   entered the graph would otherwise report green forever.

3. **`package.json`** — merge from `templates/dep-graph/package.json`: add the `dependency-cruiser`
   and `typescript` devDependencies and the `dep-graph` and `dep-graph:baseline` scripts.
   `typescript` is not decoration: it is the parser dependency-cruiser needs to see a `.ts` file at
   all (see the empty-graph guard above), and the merge adds it only where the project does not
   already declare it. `dep-graph:baseline` writes the known-violations file.

4. **The install** — `sh -c 'if test -f bun.lock -o -f bun.lockb; then bun install; elif test -f
   pnpm-lock.yaml; then pnpm install --no-frozen-lockfile; else npm install; fi'`. The contract's
   `run` is a literal command line and the three managers have no common install verb, so the recipe
   picks by the lockfile the detector already used to name the manager. It is an `if`/`elif`/`else`
   on the lockfile's **existence**, deliberately not the shorter `test -f pnpm-lock.yaml && pnpm
   install || npm install`: with the `||` form a *failing* install silently falls through to the
   next manager, which writes a second lockfile into the repo. `--no-frozen-lockfile` is required
   because this recipe *adds* a devDependency: pnpm defaults to a frozen lockfile whenever `CI` is
   set, and a frozen install refuses a `package.json` the lockfile does not yet describe
   (`ERR_PNPM_OUTDATED_LOCKFILE`) — the lockfile has to move for the new dependency to exist at all.

**A repo that already carries violations records them, it does not lower a rule.** Run
`dep-graph:baseline` (or `node_modules/.bin/depcruise --config .dependency-cruiser.cjs
--output-type baseline . > .dependency-cruiser-known-violations.json`) and commit the file: the
gate then fails on the violations a change *adds* and passes on the ones already there. The file is
the tool's own format, so it is regenerated by the tool and never hand-edited. This gate declares no
`floor`: the baseline is the repo's escape hatch, and the library's unified baseline has no
`dep-graph` count to ratchet.

## Idempotency

- `.dependency-cruiser.cjs` and `scripts/dep-graph.sh` are `create`s: byte-identical on re-run, so
  they are no-ops. A local edit shows as drift and is reported, not overwritten.
- `package.json` is a `merge`: re-running replaces this recipe's marker block and re-adds only
  missing keys. A `dep-graph` script with a different value is a collision the plan must show.
- `.dependency-cruiser-known-violations.json` is the repo's file, not the recipe's: the recipe never
  writes it, so a re-run neither regenerates nor overwrites it.

## Undo

- Delete `.dependency-cruiser.cjs`.
- Delete `scripts/dep-graph.sh`; delete `scripts/` if it is empty.
- Remove the `dependency-cruiser` and `typescript` devDependencies and the `dep-graph` and
  `dep-graph:baseline` scripts from `package.json` — only where this recipe added them.
- Delete `.dependency-cruiser-known-violations.json` if the repo no longer needs the recorded
  violations.
- Run the project's install to drop the packages.
