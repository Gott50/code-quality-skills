---
id: ci-workflow
title: CI workflow — the fast gates on every PR, mutation on PRs
purpose: Run lint, typecheck, format, the coverage gate and the mutation gate in GitHub Actions.
when:
  language: [typescript, javascript]
  packageManager: [bun]
  workspace: any
  requires: [{ file: package.json }, { recipe: biome-assist }, { recipe: oxlint-anti-slop }, { recipe: tsconfig-strict }, { recipe: bun-test-coverage }, { recipe: stryker-mutation }, { recipe: fallow-audit }]
cost: fast
priority: 20
files:
  - path: .github/workflows/ci.yml
    action: create
    scope: root
    template: templates/ci-workflow/ci.yml
commands: []
gates: []
verify:
  - run: bun -e "const y = Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text()); if (Object.keys(y.jobs).join() !== 'ci,mutation,fallow-coverage') process.exit(1)"
    scope: root
---

## Apply

1. **`.github/workflows/ci.yml`** — create from `templates/ci-workflow/ci.yml`. Three jobs, and the split is the point:
   - **`ci`** — checkout, `bun ci`, then `lint`, `typecheck`, `format:check` and `test`. `bun run test` carries the per-file coverage gate, floored by the committed baseline (100% when there is none), so the coverage gate is enforced on every PR without a separate step.
   - **`mutation`** — `if: github.event_name == 'pull_request'`, `fetch-depth: 0`, and the same `scripts/mutation-gate.ts` the pre-push hook runs, fed the PR's head and base SHAs. The strongest gate is enforced on PRs, not only on local pushes.
   - **`fallow-coverage`** — `bun run fallow:coverage` with `continue-on-error: true`. A health report, not a gate: a maintainability regression must not fail a build.

   Triggers: `pull_request` (skipping markdown-only changes) and `push` to `main`. A `concurrency` group cancels superseded runs.

The workflow reads `.bun-version` through `oven-sh/setup-bun`'s `bun-version-file`. That file is the repo-hygiene recipe's, not this one's: without it, `setup-bun` fails before any gate runs.

This recipe requires every gate recipe it wires, because the workflow calls their scripts by name. The detector reports the missing requirement as the failing reason rather than writing a workflow whose steps would fail on a missing script.

## Idempotency

- `.github/workflows/ci.yml` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.

## Undo

- Delete `.github/workflows/ci.yml`; delete `.github/workflows/` if it is empty.
