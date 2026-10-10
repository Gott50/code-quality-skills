---
id: fallow-audit
title: Dead-code and repo-health audit with fallow
purpose: Audit unused files, exports and types, and score maintainability and CRAP risk against measured coverage.
when:
  language: [typescript, javascript]
  packageManager: [bun]
  workspace: any
  requires: [{ file: package.json }, { recipe: bun-test-coverage }]
cost: fast
priority: 25
files:
  - path: .fallowrc.json
    action: create
    scope: root
    template: templates/fallow-audit/.fallowrc.json
  - path: scripts/lcov-to-istanbul.ts
    action: create
    scope: root
    template: templates/fallow-audit/scripts/lcov-to-istanbul.ts
  - path: package.json
    action: merge
    scope: root
    template: templates/fallow-audit/package.json
  - path: .husky/pre-push
    action: merge
    scope: root
    template: templates/fallow-audit/pre-push.block
commands:
  - run: bun install
    scope: root
    showInPlan: false
gates:
  - id: fallow-audit
    run: bun run fallow:audit
    description: dead code, complexity, duplication and styling in the changeset — new findings only, known ones floored by the committed dead-code and health baselines
    floor: fallow-dead-code
  - id: fallow-health
    run: bun run fallow:ratchet
    description: maintainability and CRAP ratchet — new complexity findings fail, known ones pass
    floor: fallow-health
verify:
  - gate: fallow-audit
    scope: root
---

## Apply

1. **`.fallowrc.json`** — create from `templates/fallow-audit/.fallowrc.json`. `audit.gate: new-only` is what makes the audit usable on a repo with existing debt: it fails on issues the change *introduces*, not on the ones already there. `entry` names `stryker.conf.mjs`, which is referenced only by the Stryker CLI and would otherwise be reported as an unused file. `ignorePatterns` keeps `scripts/` and `tools/` out of the audit — the vendored oxlint plugin is not the project's code. `ignoreDependencies` names `@oxlint/plugins`, which the ignored plugin imports.
2. **`scripts/lcov-to-istanbul.ts`** — create from `templates/fallow-audit/scripts/lcov-to-istanbul.ts`. bun's coverage reporter emits only `text` and `lcov`, and fallow's `--coverage` needs Istanbul `coverage-final.json`. bun's lcov carries line hits but no per-function records, so the script scans each source file for function declarations to build the function map and marks a function covered when every line of its body is hit. Under the 100% line gate every function ends up covered, so the CRAP scores reflect measured coverage rather than fallow's static estimate.
3. **`package.json`** — merge from `templates/fallow-audit/package.json`: add the `fallow` devDependency and the `fallow`, `fallow:audit`, `fallow:coverage`, `fallow:ratchet` and `fallow:raise` scripts. `fallow:ratchet` is the health gate and `fallow:raise` writes the two committed floor files `.fallow-health-baseline.json` and `.fallow-dead-code-baseline.json` (see the gate paragraph below).
4. **`.husky/pre-push`** — merge from `templates/fallow-audit/pre-push.block`, inside this recipe's marker pair.
5. **`bun install`** — installs `fallow`.
6. **`bun run fallow:raise`** — the adoption flow's baseline write for fallow's floors: it writes `.fallow-health-baseline.json` and `.fallow-dead-code-baseline.json` at the level the gates just measured, so `fallow:ratchet` and `fallow:audit` pass at the current level and the recipe is recorded. Run it after the commands phase (it needs the coverage artifact `bun run test` produces) and before the verify. The floor never rises on its own: only `fallow:raise` (or the improvement skill) raises it.

   The raise then runs the project's formatter over the two files it just wrote — `biome check --write --unsafe --linter-enabled=false` on them, or `prettier --write` when Prettier is the selection's formatter — because fallow writes them in its own layout (unsorted keys, collapsed arrays, no trailing newline) and the `format:check` gate the same selection installs would otherwise fail on files the apply itself produced. The formatting lives in the script rather than in a second sweep after it, so the raise leaves the files formatter-stable wherever it runs: the apply's baseline write, and the improvement skill's `--raise`, which calls the same script and would otherwise commit unformatted baselines. The formatter is looked up on `PATH` (which `bun run` populates from `node_modules/.bin`) and skipped when neither is installed, so the recipe stays correct on a selection that installs no formatter.

This recipe requires the `bun-test-coverage` recipe: `fallow:coverage` runs `bun run test` and then converts the lcov it produces, so without that recipe there is no coverage to score against. The detector reports the missing requirement as the failing reason rather than applying a half-wired audit.

`fallow:audit` is the changeset gate: `fallow audit` reviews the changed files for dead code, complexity, duplication and styling, and `--gate new-only` fails only on findings the changeset introduces. The committed baselines floor the known ones — `.fallow-dead-code-baseline.json` for the dead-code sub-analysis and `.fallow-health-baseline.json` for the complexity one — so a changed file carrying a baselined finding passes and a new one fails. Each flag is added only when its file exists, because fallow exits 2 on a missing baseline file, so a greenfield repo with no baseline is gated exactly as before. The health baseline is what keeps the audit from double-gating complexity: without it, the CRAP finding in this recipe's own `stryker.conf.mjs` template — which the health baseline records — is attributed as introduced and fails the gate. The health *ratchet* is still `fallow:ratchet`'s job; the audit's complexity sub-analysis is floored by the same file, not a second threshold.

**The audit's base is the merge-base with the branch's upstream, or with the remote default (`origin/HEAD`, `origin/main`, `origin/master`) when the branch has no upstream.** On a long-lived branch — or any branch whose upstream is `origin/main` — "the change" is the whole branch, so the audit reports every finding the branch carries, not the ones the last commit added. Pin the base when that is not what you want: `FALLOW_AUDIT_BASE=<ref> bun run fallow:audit` (or `fallow audit --base <ref>`), e.g. the remote sha the pre-push hook is pushing to. The gate description says "in the changeset" for exactly this reason.

`fallow` (health) is a report, not a gate — the script passes `--report-only`, so it prints maintainability and CRAP risk and always exits 0; the CI workflow runs it with `continue-on-error`, so a health regression never fails a build. The health *gate* is `fallow:ratchet`: the lcov-to-Istanbul conversion followed by `fallow health --coverage … --baseline .fallow-health-baseline.json` — known findings pass (exit 0), new ones fail (exit 1) — falling back to `--report-only` while no baseline exists. `--min-score` must never be combined with `--baseline` in one invocation, because `--min-score` replaces the finding-driven exit code and would silently defeat the baseline. `fallow:raise` writes both baselines — `fallow health --report-only --save-baseline` (the `--report-only` keeps the raise at exit 0 while findings exist) and `fallow dead-code --save-baseline` — then runs the project's formatter over the two files it wrote (step 6), and fails closed when either file was not written; run the tests first (`bun run test`) so `coverage/lcov.info` exists for the conversion.

## Idempotency

- `.fallowrc.json` and `scripts/lcov-to-istanbul.ts` are `create`s: byte-identical on re-run, so they are no-ops. A local edit shows as drift and is reported, not overwritten.
- `package.json` and `.husky/pre-push` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.
- `fallow:raise` is idempotent: re-running it rewrites the same two baselines from the same measured level, and the formatter leaves them byte-identical, so a re-run is a no-op.

## Undo

- Delete `.fallowrc.json`.
- Delete `scripts/lcov-to-istanbul.ts`; delete `scripts/` if it is empty.
- Remove the `fallow` devDependency and the `fallow`, `fallow:audit`, `fallow:coverage`, `fallow:ratchet` and `fallow:raise` scripts from `package.json` — only where this recipe added them.
- Delete `.fallow-health-baseline.json` and `.fallow-dead-code-baseline.json`.
- Remove the `code-quality:fallow-audit` block from `.husky/pre-push`; delete the file if the block is all it holds.
- `bun install` to drop the package.
