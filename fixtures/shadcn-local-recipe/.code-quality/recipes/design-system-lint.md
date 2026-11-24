---
id: design-system-lint
title: Design-system lint with @shadcn/lint
purpose: Register @shadcn/lint's no-restyle rule so a page cannot restyle a component that owns its appearance.
when:
  requires: [{ file: components.json }]
cost: fast
priority: 20
files:
  - path: eslint.config.mjs
    action: create
    scope: root
    template: templates/design-system-lint/eslint.config.mjs
gates:
  - id: design-system-lint
    run: npx eslint .
    description: The project's @shadcn/lint policy
verify:
  - run: test -f eslint.config.mjs
    scope: root
---

## Apply

1. **`eslint.config.mjs`** — create from the template named in `files`. The config registers
   `@shadcn/lint` as the `shadcn` plugin and turns `shadcn/no-restyle` on at `warn` with
   `allow: ["layout"]`, so a call site may place a component but not restyle it. A second block
   turns the rule off inside the component directory, where a component styles its own internals.
2. **The component directory** — the override names `src/components/ui`, the shadcn default. A
   project whose `components.json` `aliases.ui` resolves elsewhere edits that `files` pattern; the
   rule is the same.
3. **The gate** — `gates` names the command the project runs afterwards. `warn` is the adoption
   level `@shadcn/lint` recommends: the findings are visible without failing the build, and the
   project raises the level once the common violations are fixed.
4. **The proof** — `verify` checks that the config exists. The gate itself is the real proof and
   runs in the verify phase.

## Idempotency

- `eslint.config.mjs` is a `create`: byte-identical on re-run, so it is a no-op. A project that
  already has an ESLint config is a `create` drift — reported, and applied only on approval, so an
  existing config is never silently replaced.

## Undo

- Delete `eslint.config.mjs` — only where this recipe created it.
