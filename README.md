# code-quality-skills

An installable agent skill that wires code-quality gates into a TypeScript repo — formatting, linting, typechecking, tests, coverage, mutation testing, git hooks, and CI — from a library of recipes. It detects the stack, prints a plan, and applies it on approval.

## Install

```sh
npx skills@latest add Gott50/code-quality-skills
```

The repo exposes one skill, so the explicit form is:

```sh
npx skills@latest add Gott50/code-quality-skills -s code-quality-setup
```

The [skills CLI](https://github.com/vercel-labs/skills) copies the skill into `.agents/skills/code-quality-setup/` and records it in `skills-lock.json`. Then ask your agent to "set up code quality in this repo".

## What it does

The skill ships four dependency-free scripts (node builtins only) — three read-only, one writer:

- `scripts/detect.mjs` — reads the project and prints a JSON applicability matrix: the stack, the existing tooling, and every recipe's evaluated `when`.
- `scripts/plan.mjs` — runs the detector and prints the plan the agent shows for approval: the selection, the applicability matrix, every file to be written, every command to be run, and the gates left behind.
- `scripts/manifest.mjs` — the canonical writer for `.code-quality.json`, the applied-state manifest the agent records each recipe through (ADR 0002).
- `scripts/score.mjs` — the read-only score view: reads each gate's artifact and prints the per-gate level, with fallow's maintainability as the headline; `--raise` writes the committed floor file `.code-quality-baseline.json`.

The agent prints the plan, asks once, and applies it. It never improvises the plan. Applying is agent-driven — there is no `apply.mjs` — and each recipe is recorded in `.code-quality.json` as it completes.

## Recipes

Each recipe is one file at `skills/code-quality-setup/references/recipes/<id>.md`: machine-checkable frontmatter plus a body the agent executes. The contract is [RECIPE-CONTRACT.md](skills/code-quality-setup/RECIPE-CONTRACT.md).

| Recipe | What it wires |
|---|---|
| `repo-hygiene` / `repo-hygiene-npm` | runtime pin, ignore entries, and the husky `prepare` hook |
| `biome-assist` / `biome-assist-npm` | Biome format and assist, wired to pre-commit |
| `oxlint-anti-slop` / `oxlint-anti-slop-npm` | oxlint with the vendored anti-slop rules |
| `tsconfig-strict` / `tsconfig-strict-npm` | strict compiler options and the `tsc --noEmit` typecheck gate |
| `bun-test-coverage` | `bun test` with a per-file coverage gate floored by the committed baseline |
| `vitest-coverage` | Vitest with a per-file coverage gate floored by the committed baseline |
| `stryker-mutation` / `stryker-mutation-vitest` | Stryker mutation gate on pre-push |
| `fallow-audit` / `fallow-audit-npm` | dead-code and repo-health audit with fallow |
| `ci-workflow` / `ci-workflow-npm` | the fast gates on every PR, mutation on PRs |
| `ci-drift` | the skill's drift report as one sticky, non-blocking PR comment |
| `eslint-prettier` | an existing ESLint + Prettier setup as the lint and format gates |
| `agent-guidance` | a lean `AGENTS.md` section pointing at `docs/code-quality.md` |

The unsuffixed recipes target Bun; the `-npm` variants target npm and pnpm. `eslint-prettier` is the npm/pnpm alternative to `biome-assist-npm` for a project that already runs ESLint + Prettier.

## Update and drift

Two different things:

- **Update** — `npx skills@latest update` re-fetches the skill from this repo. The lockfile's `computedHash` covers every file in the skill directory, so a change to a recipe or a template is visible to `update`.
- **Drift** — re-running the skill against a project compares the files it wrote against the filesystem. The filesystem is the source of truth; `.code-quality.json` is an optimization. Per owned file: **intact**; **drifted** (hand-edited — shown as a diff, applied only on approval, never silently overwritten); **missing** (deleted by hand — reinstated on approval). A `merge` never drifts: its own marker block is replaced. A re-render the current library changed is an **update**, not drift.

## Layout

```
skills/code-quality-setup/   the installable skill
  SKILL.md                   the entry point
  RECIPE-CONTRACT.md         the recipe frontmatter and body contract
  references/recipes/        the recipe library
  templates/<id>/            the files each recipe writes
  scripts/                   detect.mjs, plan.mjs, score.mjs, and their schemas
fixtures/                    throwaway projects the detector and recipes are verified against
.agents/skills/              vendored third-party skills (mattpocock/skills)
```

Fixtures live at the repo root, not inside the skill: the skills CLI copies the whole skill directory into every consumer's install, so anything in there ships to every user and churns the lockfile hash.
