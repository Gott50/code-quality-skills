# Fixtures

Four throwaway projects the detector is run against, and the projects a recipe is verified by
applying to. No `node_modules`, no `SKILL.md` (a nested `SKILL.md` would be discovered as a skill of
its own by the `skills` CLI).

They live at the repo root, not inside `skills/code-quality-setup/`: the `skills` CLI copies the
whole skill directory into every consumer's install, and the lockfile's `computedHash` covers every
file in it, so fixtures in there would ship to every user and churn the hash.

```
node skills/code-quality-setup/scripts/detect.mjs fixtures/<name>
```

| Fixture | Shape | What it exercises |
|---|---|---|
| `plain-ts` | npm, single package, strict `tsconfig.json`, no tooling | the **full npm path** — every npm recipe applies (`repo-hygiene-npm` … `ci-workflow-npm`), no collisions, no hold-backs |
| `bun-ts` | Bun, single package, `biome.json` + `.husky/pre-commit` already present | the **Bun happy path** — every Bun recipe applies; the apply target for a Bun recipe |
| `pnpm-workspace` | pnpm, `pnpm-workspace.yaml`, two members, CI workflow at the root | **workspace enumeration** and per-package tooling: vitest + coverage in `packages/a`, eslint + prettier in `packages/b`, a solution-style root `tsconfig.json` over a strict `tsconfig.base.json`; plus the **`conflicts.tools` collision** and the **`conflicts.recipes` hold-back** (member-level evidence) |
| `npm-eslint-prettier` | npm, single package, eslint + prettier at the root | the **`conflicts.tools` collision** and the **`conflicts.recipes` hold-back** at root level: `biome-assist-npm` collides with the project's prettier + eslint, and `eslint-prettier` is held back |

The two conflict paths are reachable because the npm/pnpm formatter variant landed: `biome-assist-npm`
declares `conflicts.tools: [prettier, eslint]` and `conflicts.recipes: [eslint-prettier]`, so a
project that already runs ESLint + Prettier reports the collision *and* holds the competing recipe
back. `pnpm-workspace` reaches both from a member's tooling; `npm-eslint-prettier` from the root.

`plain-ts` no longer exercises the **empty selection**: with the npm variants in the library, a plain
npm TypeScript repo now selects every npm recipe. The "nothing applies" entry state is reached by a
directory with no TypeScript and no manifest — this repo's own root is the usual probe:

```
node skills/code-quality-setup/scripts/detect.mjs .
```
