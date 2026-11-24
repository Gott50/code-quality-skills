# shadcn-ts

A shadcn/ui-shaped project: `components.json`, a Tailwind v4 dependency, a `cva`-based Button under
`components/ui/`, and the `@/*` alias the components use.

It exists to prove the `design-system-contracts` practice's selection. The practice's predicate is
`{ file: components.json }`, so the detector selects it here and not on `plain-ts`, which has no
`components.json`:

```
node skills/code-quality-setup/scripts/detect.mjs fixtures/shadcn-ts
node skills/code-quality-setup/scripts/plan.mjs fixtures/shadcn-ts
```

The plan lists the practice and renders its pointer into the agent-guidance block; the practice's
`enforcedBy` is empty because the gate is a project-local recipe, not a library recipe.

The fixture is not installed: `clsx`, `tailwind-merge`, `class-variance-authority` and `react` are
imported by the components but deliberately absent from `package.json`, so the imports are
illustrative and nothing here is built.
