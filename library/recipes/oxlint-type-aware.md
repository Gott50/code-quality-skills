---
id: oxlint-type-aware
title: Type-aware linting with oxlint and tsgolint
purpose: Turn on oxlint's type-aware rules — floating promises, unsafe any, unnecessary conditions — behind a wall of zero.
when:
  language: [typescript, javascript]
  packageManager: [bun]
  workspace: any
  requires: [{ file: package.json }, { recipe: oxlint-anti-slop }, { tsconfig: strictNullChecks }]
cost: fast
priority: 46
files:
  - path: oxlint.type-aware.config.ts
    action: create
    scope: root
    template: templates/oxlint-type-aware/oxlint.type-aware.config.ts
  - path: scripts/lint-type-aware-gate.mjs
    action: create
    scope: root
    template: templates/oxlint-type-aware/scripts/lint-type-aware-gate.mjs
  - path: package.json
    action: merge
    scope: root
    template: templates/oxlint-type-aware/package.json
commands:
  - run: bun install
    scope: root
    showInPlan: false
gates:
  - id: lint-type-aware
    run: bun run lint:type-aware
    description: oxlint with the type-aware rules — a wall at zero diagnostics
verify:
  - gate: lint-type-aware
    scope: root
---

## Apply

1. **`oxlint.type-aware.config.ts`** — create from `templates/oxlint-type-aware/oxlint.type-aware.config.ts`. It spreads the base config the `oxlint-anti-slop` recipe wrote — the anti-slop rules, the size and complexity caps, the test-file overrides, and the `jsPlugins` specifier, which resolves relative to this file because it sits beside the base at the workspace root — and adds `options: { typeAware: true }` plus the 13 `typescript/*` rules that need the whole project's types. The option and the `oxlint-tsgolint` dependency move together: with the option set and the package absent, oxlint refuses to start; with the option absent, the rules are silently skipped.
2. **`scripts/lint-type-aware-gate.mjs`** — create from `templates/oxlint-type-aware/scripts/lint-type-aware-gate.mjs`, **root-scoped**. It runs oxlint with `--config oxlint.type-aware.config.ts --disable-nested-config --format json` and fails on any diagnostic. The gate is a **wall at zero**, not a floor: the unified baseline's `lint` count is the syntactic run's diagnostic count, a different measure, so this gate cannot read it — the same reason `eslint-prettier`'s `lint` gate declares no floor. `--disable-nested-config` makes the root config cover every file, because the type-aware pass analyses the whole project and a workspace member's own `oxlint.config.ts` must not narrow it.
3. **`package.json`** — merge from `templates/oxlint-type-aware/package.json`: add the `oxlint-tsgolint` devDependency and the `lint:type-aware` script, `bun scripts/lint-type-aware-gate.mjs`. Existing keys are never overwritten; a differing value is a collision the plan must show.
4. **`bun install`** — installs `oxlint-tsgolint`.

The recipe applies only when the project's tsconfig chain turns on `strictNullChecks` (`requires: [{ tsconfig: strictNullChecks }]`), because the nullability rules are useless without it: TypeScript erases `undefined` and `null` from the types when the option is off, so `no-unnecessary-condition` and the `no-unsafe-*` family would report nothing. `strict: true` implies the option, so a project that ran `tsconfig-strict` satisfies the predicate.

The gate is a wall, and the type-aware rules are the ones with documented false positives — a possibly-undefined indexed access, a value narrowed inside a callback. A project that cannot reach zero has two honest moves: suppress the report with a reason (see `docs/code-quality/practices/lint-suppressions.md`), or do not select this recipe. It must not lower a floor, because this gate has none to lower.

## Idempotency

- Both `create`s are byte-identical on re-run, so they are a no-op. A local edit shows as drift and is reported, not overwritten.
- `package.json` is a `merge`: re-running replaces this recipe's marker block and re-adds only missing keys.

## Undo

- Delete `oxlint.type-aware.config.ts`.
- Delete `scripts/lint-type-aware-gate.mjs`; delete `scripts/` if it is empty.
- Remove the `oxlint-tsgolint` devDependency and the `lint:type-aware` script from `package.json` — only where this recipe added them.
- `bun install` to drop the package.
