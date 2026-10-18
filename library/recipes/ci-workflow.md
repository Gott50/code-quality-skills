---
id: ci-workflow
title: CI workflow — the fast gates on every PR, mutation on PRs
purpose: Run lint, typecheck, format, the coverage gate and the mutation gate in GitHub Actions.
when:
  language: [typescript, javascript]
  packageManager: [bun]
  workspace: any
  requires: [{ file: package.json }, { recipe: biome-assist }, { recipe: oxlint-anti-slop }, { recipe: tsconfig-strict }, { recipe: bun-test-coverage }, { recipe: fallow-audit }]
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
  - run: node -e 'const fs=require("node:fs"),s=fs.readFileSync(".github/workflows/ci.yml","utf8"),L=s.split("\n"),die=(m)=>{console.error(m);process.exit(1)};const j=L.findIndex((l)=>/^  ci:$/.test(l));if(j<0)die("no ci job");const n=L.findIndex((l,index)=>index>j&&/^  \S+:$/.test(l));const block=L.slice(j+1,n<0?L.length:n).join("\n");if(!/actions\/checkout@/.test(block))die("ci job has no checkout step");if(!/CODE_QUALITY_BASE_REF: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/.test(block))die("the test step does not pass the PR base ref to the coverage gate");if(!/fetch-depth: 0/.test(block))die("the ci checkout does not fetch the base ref");'
    scope: root
---

## Apply

1. **`.github/workflows/ci.yml`** — create from `templates/ci-workflow/ci.yml`. Three jobs, and the split is the point:
   - **`ci`** — checkout, `bun ci`, then `lint`, `typecheck`, `format:check` and `test`. `bun run test` carries the per-file coverage gate, floored by the committed baseline (100% when there is none), so the coverage gate is enforced on every PR without a separate step.
   - **`mutation`** — `if: github.event_name == 'pull_request'`, `fetch-depth: 0`, and the same `scripts/mutation-gate.ts` the pre-push hook runs, fed the PR's head and base SHAs. The strongest gate is enforced on PRs, not only on local pushes. The gate step itself carries `if: hashFiles('scripts/mutation-gate.ts') != ''`, so a repo without the `stryker-mutation` recipe runs the job's checkout and install and then skips the gate rather than failing on a missing script. The `if` is step-level because a job-level `hashFiles` is evaluated before the checkout and sees no files.
   - **`fallow-coverage`** — `bun run test` plus the lcov→Istanbul conversion (`bun scripts/lcov-to-istanbul.ts --lcov coverage/lcov.info --out coverage/coverage-final.json`) to produce the Istanbul coverage, then the `fallow-rs/fallow` Action with `command: health`, `coverage: coverage/coverage-final.json`, `score: true`, `fail-on-issues: false` and `fail-on-empty-analysis: true`. A health report, not a gate: `fail-on-issues: false` keeps a maintainability regression from failing a build, while `fail-on-empty-analysis: true` still fails a run that analyzed no source file — every count is zero there for the wrong reason, which is indistinguishable from a clean project. The Action reads the fallow version from the project's `package.json` spec, so it runs the same pinned release the scripts do. The conversion is explicit because bun's coverage reporter emits only `text` and `lcov`: `bun run test` alone leaves `coverage/coverage-final.json` absent, and the Action would then score fallow's static estimate instead of measured coverage.

   Triggers: `pull_request` (skipping markdown-only changes) and `push` to `main`. A `concurrency` group cancels superseded runs.

The workflow reads `.bun-version` through `oven-sh/setup-bun`'s `bun-version-file`. That file is the repo-hygiene recipe's, not this one's: without it, `setup-bun` fails before any gate runs.

The `ci` job's test step sets `CODE_QUALITY_BASE_REF` to `github.event.pull_request.base.sha`, which turns on the coverage gate's changed-lines mode: on a PR, the lines the change adds or modifies must be executed, while the per-file floor still governs the whole file. The job's checkout carries `fetch-depth: 0` because the base SHA is not in a depth-1 clone, and the gate fails closed on a diff it cannot compute — so a shallow checkout would fail every PR for the wrong reason. On a push the context is empty, the variable is the empty string, and the gate treats it as absent (the per-file floor is the whole rule). The recipe's second `verify` asserts both wirings against the generated workflow: the checkout fetches the base ref, and the test step passes it.

This recipe requires the fast-gate recipes it wires — `biome-assist`, `oxlint-anti-slop`, `tsconfig-strict`, `bun-test-coverage` and `fallow-audit` — because the workflow calls their scripts by name. The detector reports a missing one as the failing reason rather than writing a workflow whose steps would fail on a missing script.

It deliberately does **not** require `stryker-mutation`. The `mutation` job's gate step is conditional on `scripts/mutation-gate.ts` existing, so a repo the mutation recipe does not select — one with no test file, which the recipe's `requires: [{ testFile: true }]` excludes (#170) — still gets lint, typecheck, format and the coverage gate in CI. Requiring the mutation recipe would cascade its absence into losing the whole workflow, which is worse than the red mutation gate it replaced.

## Idempotency

- `.github/workflows/ci.yml` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.

## Undo

- Delete `.github/workflows/ci.yml`; delete `.github/workflows/` if it is empty.
