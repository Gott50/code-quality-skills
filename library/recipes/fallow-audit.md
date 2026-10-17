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
    description: dead code and complexity introduced by the changeset — new findings only, known ones floored by the committed dead-code and health baselines, and the committed baselines are shrink-only; duplication and styling are reported but advisory (verdict-neutral)
    floor: fallow-dead-code
  - id: fallow-health
    run: bun run fallow:ratchet
    description: maintainability and CRAP ratchet — new complexity findings fail, known ones pass, and a stale health-baseline entry fails
    floor: fallow-health
  - id: fallow-dead-code-staleness
    run: bun run fallow:dead-code
    description: whole-project dead-code staleness — a committed dead-code-baseline entry that matches nothing fails
verify:
  - gate: fallow-audit
    scope: root
  - gate: fallow-dead-code-staleness
    scope: root
---

## Apply

1. **`.fallowrc.json`** — create from `templates/fallow-audit/.fallowrc.json`. `audit.gate: new-only` is what makes the audit usable on a repo with existing debt: it fails on issues the change *introduces*, not on the ones already there. `entry` names `stryker.conf.mjs`, which is referenced only by the Stryker CLI and would otherwise be reported as an unused file. `ignorePatterns` keeps `scripts/` and `tools/` out of the audit — the vendored oxlint plugin is not the project's code. `ignoreDependencies` names `@oxlint/plugins`, which the ignored plugin imports. `rules` sets `unresolved-imports` and `unlisted-dependencies` to `error` — the two categories fallow calls correctness issues, so they are never baselined — and promotes `stale-suppressions` from its `warn` default to `error` and `require-suppression-reason` from its `off` default to `error`, so a suppression that no longer suppresses anything and a suppression with no stated reason both fail. `failOnParseError: true` arms the parse-error gate: a file the parser could not read cleanly fails the run instead of only warning, because a file that was not parsed is a file that was not analyzed. `minimumVersion` names the fallow release the config is written for, so an older binary stops with a message naming both versions instead of failing on the first field it does not recognize.
2. **`scripts/lcov-to-istanbul.ts`** — create from `templates/fallow-audit/scripts/lcov-to-istanbul.ts`. bun's coverage reporter emits only `text` and `lcov`, and fallow's `--coverage` needs Istanbul `coverage-final.json`. bun's lcov carries line hits but no per-function records, so the script scans each source file for function declarations to build the function map and marks a function covered when every line of its body is hit. Under the 100% line gate every function ends up covered, so the CRAP scores reflect measured coverage rather than fallow's static estimate.
3. **`package.json`** — merge from `templates/fallow-audit/package.json`: add the `fallow` devDependency and the `fallow`, `fallow:audit`, `fallow:coverage`, `fallow:dead-code`, `fallow:ratchet` and `fallow:raise` scripts. `fallow:ratchet` is the health gate, `fallow:dead-code` is the whole-project dead-code staleness gate, and `fallow:raise` writes the two committed floor files `.fallow-health-baseline.json` and `.fallow-dead-code-baseline.json` (see the gate paragraph below).
4. **`.husky/pre-push`** — merge from `templates/fallow-audit/pre-push.block`, inside this recipe's marker pair.
5. **`bun install`** — installs `fallow`.
6. **`bun run fallow:raise`** — the adoption flow's baseline write for fallow's floors: it writes `.fallow-health-baseline.json` and `.fallow-dead-code-baseline.json` at the level the gates just measured, so `fallow:ratchet` and `fallow:audit` pass at the current level and the recipe is recorded. Run it after the commands phase (it needs the coverage artifact `bun run test` produces) and before the verify. The floor never rises on its own: only `fallow:raise` (or the improvement skill) raises it.

   The raise then runs the project's formatter over the two files it just wrote — `biome check --write --unsafe --linter-enabled=false` on them, or `prettier --write` when Prettier is the selection's formatter — because fallow writes them in its own layout (unsorted keys, collapsed arrays, no trailing newline) and the `format:check` gate the same selection installs would otherwise fail on files the apply itself produced. The formatting lives in the script rather than in a second sweep after it, so the raise leaves the files formatter-stable wherever it runs: the apply's baseline write, and the improvement skill's `--raise`, which calls the same script and would otherwise commit unformatted baselines. The formatter is looked up on `PATH` (which `bun run` populates from `node_modules/.bin`); when neither is installed the raise still appends a trailing newline to each file, so the baselines end in a newline — the one thing every formatter agrees on — and a selection whose formatter is neither biome nor Prettier (dprint, say) does not fail its `format:check` on the newline-less file fallow writes.

This recipe requires the `bun-test-coverage` recipe: `fallow:coverage` runs `bun run test` and then converts the lcov it produces, so without that recipe there is no coverage to score against. The detector reports the missing requirement as the failing reason rather than applying a half-wired audit.

`fallow:audit` is the changeset gate: `fallow audit` reviews the changed files for dead code, complexity, duplication and styling, and `--gate new-only` fails only on the error-severity findings the changeset introduces. In the pinned fallow 3.33.1 those are dead code and complexity — their rules default to `error` — so they are what the gate actually blocks. Duplication and styling are reported but verdict-neutral: duplication has no rule id to re-severity, and the `css-*` styling rules default to `warn`, so a changeset that introduces only duplication or styling findings exits 0 with verdict `warn`. Styling can be promoted to a gate by setting the `css-*` rules to `error` in `.fallowrc.json`; duplication cannot be gated at all in 3.33.1. The committed baselines floor the known ones — `.fallow-dead-code-baseline.json` for the dead-code sub-analysis and `.fallow-health-baseline.json` for the complexity one — so a changed file carrying a baselined finding passes and a new one fails. Each flag is added only when its file exists, because fallow exits 2 on a missing baseline file, so a greenfield repo with no baseline is gated exactly as before — the audit's `new-only` gate stays active, failing on the findings the changeset introduces, with no grandfathers. The health baseline is what keeps the audit from double-gating complexity: without it, the CRAP finding in this recipe's own `stryker.conf.mjs` template — which the health baseline records — is attributed as introduced and fails the gate. The health *ratchet* is still `fallow:ratchet`'s job; the audit's complexity sub-analysis is floored by the same file, not a second threshold.

**The committed baselines are shrink-only.** When a baseline is loaded, the script also passes `--fail-on-baseline-growth --baseline-base <ref>`, which fails the run when the working-tree baseline has a key the same file at the base ref does not — the change that adds a finding and re-saves the baseline in the same commit. The base ref is `FALLOW_AUDIT_BASE` when set, else the merge-base with the remote default branch, else the current branch name; the flag is passed only when a baseline exists, because fallow exits 2 on `--fail-on-baseline-growth` with no baseline to compare. A baseline the base ref does not have is a new baseline and passes with a note, so the commit that first introduces the baseline is not growth.

**The audit's base is the merge-base with the branch's upstream, or with the remote default (`origin/HEAD`, `origin/main`, `origin/master`) when the branch has no upstream.** On a long-lived branch — or any branch whose upstream is `origin/main` — "the change" is the whole branch, so the audit reports every finding the branch carries, not the ones the last commit added. Pin the base when that is not what you want: `FALLOW_AUDIT_BASE=<ref> bun run fallow:audit` (or `fallow audit --base <ref>`), e.g. the remote sha the pre-push hook is pushing to. The gate description says "in the changeset" for exactly this reason. A target that is not a git repository at all has no base to detect — `fallow audit` exits 2 with `could not detect base branch` — so the apply target must be a git repo with at least one commit (one commit and no remote is enough: the audit reports `base_description: "local main"`). The plan surfaces this requirement: on a repo with no commits it warns under **Warnings** that the audit's base cannot be detected, so the consumer commits before the verify (or pins the base) instead of hitting the failure.

`fallow` (health) is a report, not a gate — the script passes `--report-only`, so it prints maintainability and CRAP risk and always exits 0; the CI workflow runs it as a non-blocking report, so a health regression never fails a build. The health *gate* is `fallow:ratchet`: the lcov-to-Istanbul conversion followed by `fallow health --coverage … --baseline .fallow-health-baseline.json --fail-on-stale-baseline` — known findings pass (exit 0), new ones fail (exit 1), and a baseline entry that matched nothing fails (exit 1) — falling back to the plain gate while no baseline exists: `fallow health --coverage …` with no `--baseline` and no `--report-only`, which fails on any error-severity complexity finding (the greenfield wall), and prints the mode and the `fallow:raise` command that records the current level on stderr. `--min-score` must never be combined with `--baseline` in one invocation, because `--min-score` replaces the finding-driven exit code and would silently defeat the baseline. The dead-code baseline's staleness is the third gate, `fallow:dead-code-staleness`: `fallow:dead-code` runs `fallow dead-code --baseline .fallow-dead-code-baseline.json --fail-on-stale-baseline` over the whole project, because the audit is change-scoped by construction and cannot judge a whole-project baseline — an audit that loaded one reports `gate_outcomes["stale-baseline"]` as `skipped`, and `--fail-on-stale-baseline` never fires there. With no baseline file the script prints that there is nothing to check and exits 0. `fallow:raise` writes both baselines — `fallow health --report-only --save-baseline` (the `--report-only` keeps the raise at exit 0 while findings exist) and `fallow dead-code --save-baseline` — then runs the project's formatter over the two files it wrote (step 6), and fails closed when either file was not written; run the tests first (`bun run test`) so `coverage/lcov.info` exists for the conversion.

## Idempotency

- `.fallowrc.json` and `scripts/lcov-to-istanbul.ts` are `create`s: byte-identical on re-run, so they are no-ops. A local edit shows as drift and is reported, not overwritten.
- `package.json` and `.husky/pre-push` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.
- `fallow:raise` is idempotent: re-running it rewrites the same two baselines from the same measured level, and the formatter leaves them byte-identical, so a re-run is a no-op.

## Undo

- Delete `.fallowrc.json`.
- Delete `scripts/lcov-to-istanbul.ts`; delete `scripts/` if it is empty.
- Remove the `fallow` devDependency and the `fallow`, `fallow:audit`, `fallow:coverage`, `fallow:dead-code`, `fallow:ratchet` and `fallow:raise` scripts from `package.json` — only where this recipe added them.
- Delete `.fallow-health-baseline.json` and `.fallow-dead-code-baseline.json`.
- Remove the `code-quality:fallow-audit` block from `.husky/pre-push`; delete the file if the block is all it holds.
- `bun install` to drop the package.
