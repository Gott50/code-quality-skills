# Fixtures

Three throwaway projects the detector is run against, and the projects a recipe is verified by
applying to. No `node_modules`, no `SKILL.md` (a nested `SKILL.md` would be discovered as a skill of
its own by the `skills` CLI).

```
node scripts/detect.mjs fixtures/<name>
```

| Fixture | Shape | What it exercises |
|---|---|---|
| `plain-ts` | npm, single package, strict `tsconfig.json`, no tooling | the **empty selection** — nothing applies, and the report says why per recipe |
| `bun-ts` | Bun, single package, `biome.json` + `.husky/pre-commit` already present | the **happy path** — `biome-assist` + `agent-guidance` selected, no collisions; the apply target for a Bun recipe |
| `pnpm-workspace` | pnpm, `pnpm-workspace.yaml`, two members, CI workflow at the root | **workspace enumeration** and per-package tooling: vitest + coverage in `packages/a`, eslint + prettier in `packages/b`, a solution-style root `tsconfig.json` over a strict `tsconfig.base.json` |

Two paths have no committed fixture yet, because the only formatter recipe is Bun-gated and the
npm/pnpm variants have not landed:

- **`conflicts.tools`** — `pnpm-workspace/packages/b` carries prettier + eslint ready for it, but
  nothing selects a recipe that declares them as conflicts.
- **`heldBack`** — needs two recipes that genuinely conflict.

Both are proven on scratch copies; see `prototype/transcript.txt` on branch `prototype/detector`.
