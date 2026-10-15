# Fixtures

Seven throwaway projects the detector is run against, and the projects a recipe is verified by
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
| `plain-ts` | npm, single package, strict `tsconfig.json`, no tooling, no test file | the **full npm path** — every npm recipe applies except the one the test-file predicate gates (`stryker-mutation-vitest`), no collisions, no hold-backs |
| `bun-ts` | Bun, single package, `biome.json` + `.husky/pre-commit` already present, one covered function under `src/` with its test under `test/` | the **Bun happy path** — every Bun recipe applies and every gate can go green, not just the detection; the apply target for a Bun recipe |
| `bun-workspace` | Bun, `workspaces` in the root `package.json`, two members at different depths (`packages/a`, `packages/nested/b`), no tooling | the **workspace form** — the apply target for the workspace-scoped recipes: `{{root}}` substitution at two depths (`../..`, `../../..`) and per-member config placement |
| `pnpm-workspace` | pnpm, `pnpm-workspace.yaml`, two members at different depths (`packages/a`, `packages/nested/b`), CI workflow at the root | **workspace enumeration** and per-package tooling: eslint + prettier in `packages/nested/b`, a root `tsconfig.json` extending a strict `tsconfig.base.json`; plus the **`conflicts.tools` collision** and the **`conflicts.recipes` hold-back** (member-level evidence); the apply target for the npm/pnpm workspace variants |
| `npm-eslint-prettier` | npm, single package, eslint + prettier at the root | the **`conflicts.tools` collision** and the **`conflicts.recipes` hold-back** at root level: `biome-assist-npm` collides with the project's prettier + eslint, and `eslint-prettier` is held back |
| `local-recipe` | npm, single package, strict `tsconfig.json`, a `.code-quality/` local library (two recipes + their templates), and a `dprint.json` no library recipe covers | the **local library layer** — the detector reads `.code-quality/recipes/` alongside the library, a local recipe wins on id collision (`repo-hygiene-npm` is shadowed), and `gaps.mjs` reports the `uncovered-category: formatter — dprint` gap. The `one-predicate-away` kind is reachable only in the repo-layout probe (`node skills/code-quality-author/scripts/gaps.mjs fixtures/local-recipe`): a real consumer has the setup skill installed at `.agents/skills/code-quality-setup/scripts/plan.mjs`, so `ci-drift`'s `when.requires` passes and it is *selected*, not one predicate away. The probe reports two — `ci-drift` (the missing installed skill) and `stryker-mutation-vitest` (the test-file predicate) |
| `debt-ts` | Bun, single package, strict `tsconfig.json`, one covered function plus deliberate debt under `src/` | the **debt-carrying apply target** — the five shapes the quality ratchet measures: **coverage** (`src/index.ts` at 56.67% lines; `src/unused.ts` never imported), **mutation** (`formatDuration`'s `< 60` boundary and its uncovered minutes branch leave survivors), **lint** (`anti-slop/no-runtime-typeof` at `src/index.ts:14`), **dead code** (`src/unused.ts` and the `legacyFormat` export), and **complexity** (`describeHttpStatus`, cyclomatic complexity 14) |

**A fresh copy of an apply-target fixture must be a git repository with at least one commit.** The
`fallow-audit` recipe's verify is `bun run fallow:audit`, and `fallow audit` detects its base ref from
git: with no `.git` it exits 2 (`could not detect base branch`). The fixtures are tracked in this
repo, but a copy of one carries no `.git`, so init and commit the copy before running the verify:

```
cp -R fixtures/debt-ts/. /tmp/acc-fixture && cd /tmp/acc-fixture
git init -b main && git add -A && git commit -m init
```

One commit and no remote is enough — the audit reports `base_description: "local main"` and passes.
Committing the pristine copy leaves the apply's own files as the changeset; the baselines the apply
writes floor the known findings, so the audit still passes.

The two conflict paths are reachable because the npm/pnpm formatter variant landed: `biome-assist-npm`
declares `conflicts.tools: [prettier, eslint]` and `conflicts.recipes: [eslint-prettier]`, so a
project that already runs ESLint + Prettier reports the collision *and* holds the competing recipe
back. `pnpm-workspace` reaches both from a member's tooling; `npm-eslint-prettier` from the root.

`pnpm-workspace`'s `packages/a/vitest.config.ts` is a hand-written stub, not an older render: its only
line the `vitest-coverage` template does not own is `thresholds: { perFile: true, lines: 100,
functions: 100 }`, at a key the template declares. The plan reads it as `update` — a repo line whose
key the template declares is the library's value moving, not the repo's content (#167) — so the
fixture's plan shows one fewer `loss` than it did before that fix. `pnpm-workspace` is an apply
target, so the apply **re-renders** that member config from the template rather than skipping it: the
stub is replaced, which is the intended behavior for a file whose keys are a subset of the
template's.

**The mutation recipes need a test file.** `stryker-mutation` and `stryker-mutation-vitest` carry
`requires: [{ testFile: true }]` (#170): a repo with no test file gets no mutation gate, because the
runner exits non-zero on an empty test set — the Bun runner rejects `--pass-with-no-tests`, so the
gate cannot be made green the way the coverage gates were. Three fixtures have no test file and
therefore lose the mutation recipe — `plain-ts`, `npm-eslint-prettier` and `local-recipe`.
`bun-ts`, `bun-workspace` and `debt-ts` keep `stryker-mutation`; `pnpm-workspace` keeps
`stryker-mutation-vitest`.

**The CI workflow does not cascade off the mutation recipe.** `ci-workflow` and `ci-workflow-npm`
used to require `stryker-mutation` / `stryker-mutation-vitest`, so a testless repo lost the whole
workflow — no lint, typecheck, format or test in CI, a worse outcome than the red mutation gate it
replaced. The requirement is gone: the workflow's `mutation` job keeps its
`if: github.event_name == 'pull_request'`, and the step that runs `scripts/mutation-gate.ts` carries
a step-level `if: hashFiles('scripts/mutation-gate.ts') != ''` (a job-level `hashFiles` is evaluated
before the checkout and sees no files). A repo without the mutation recipe runs the job's checkout
and install and then skips the gate. So `plain-ts`, `npm-eslint-prettier` and `local-recipe` select
`ci-workflow-npm` while `stryker-mutation-vitest` stays unselected.

`plain-ts` no longer exercises the **empty selection**: with the npm variants in the library, a plain
npm TypeScript repo selects every npm recipe that does not need a test file. The "nothing applies"
entry state is reached by a directory with no TypeScript and no manifest — this repo's own root is
the usual probe:

```
node skills/code-quality-setup/scripts/detect.mjs .
```
