---
id: ci-workflow-npm
title: CI workflow — the fast gates on every PR, mutation on PRs (npm/pnpm)
purpose: Run lint, typecheck, format, the coverage gate and the mutation gate in GitHub Actions.
when:
  language: [typescript, javascript]
  packageManager: [npm, pnpm]
  workspace: any
  requires: [{ file: package.json }, { recipe: biome-assist-npm }, { recipe: oxlint-anti-slop-npm }, { recipe: tsconfig-strict-npm }, { recipe: vitest-coverage }, { recipe: stryker-mutation-vitest }, { recipe: fallow-audit-npm }]
cost: fast
priority: 20
files:
  - path: .github/workflows/ci.yml
    action: create
    scope: root
    template: templates/ci-workflow-npm/ci.yml
commands: []
gates: []
verify:
  - run: test -f .github/workflows/ci.yml && grep -q "node-version-file" .github/workflows/ci.yml && grep -q "npm run test" .github/workflows/ci.yml
    scope: root
---

## Apply

1. **`.github/workflows/ci.yml`** — create from `templates/ci-workflow-npm/ci.yml`. Three jobs, and the split is the point:
   - **`ci`** — checkout, `setup-node` from `.node-version`, install, then `lint`, `typecheck`, `format:check` and `test`. `npm run test` carries the per-file coverage gate, floored by the committed baseline (100% when there is none), so the coverage gate is enforced on every PR without a separate step.
   - **`mutation`** — `if: github.event_name == 'pull_request'`, `fetch-depth: 0`, and the same `scripts/mutation-gate.ts` the pre-push hook runs, fed the PR's head and base SHAs through `npx tsx`.
   - **`fallow-coverage`** — `npm run fallow:coverage` with `continue-on-error: true`. A health report, not a gate.

   Triggers: `pull_request` (skipping markdown-only changes) and `push` to `main`. A `concurrency` group cancels superseded runs.

The install step is `sh -c 'test -f pnpm-lock.yaml && (corepack enable && pnpm install --frozen-lockfile) || npm ci'`: one workflow serves both managers, and the lockfile the detector already used to name the manager is the same evidence the runner picks by. `corepack enable` is what makes `pnpm` available on the runner without a separate setup action.

The workflow reads `.node-version` through `actions/setup-node`'s `node-version-file`. That file is the `repo-hygiene-npm` recipe's, not this one's: without it, `setup-node` fails before any gate runs.

This recipe requires every gate recipe it wires, because the workflow calls their scripts by name. The detector reports the missing requirement as the failing reason rather than writing a workflow whose steps would fail on a missing script.

## Idempotency

- `.github/workflows/ci.yml` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.

## Undo

- Delete `.github/workflows/ci.yml`; delete `.github/workflows/` if it is empty.
