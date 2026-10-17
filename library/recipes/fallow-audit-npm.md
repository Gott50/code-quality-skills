---
id: fallow-audit-npm
title: Dead-code and repo-health audit with fallow (npm/pnpm)
purpose: Audit unused files, exports and types, and score maintainability and CRAP risk against measured coverage.
when:
  language: [typescript, javascript]
  packageManager: [npm, pnpm]
  workspace: any
  requires: [{ file: package.json }, { recipe: vitest-coverage }]
cost: fast
priority: 25
files:
  - path: .fallowrc.json
    action: create
    scope: root
    template: templates/fallow-audit/.fallowrc.json
  - path: package.json
    action: merge
    scope: root
    template: templates/fallow-audit-npm/package.json
  - path: .husky/pre-push
    action: merge
    scope: root
    template: templates/fallow-audit-npm/pre-push.block
commands:
  - run: sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'
    scope: root
    showInPlan: false
gates:
  - id: fallow-audit
    run: npm run fallow:audit
    description: dead code and complexity introduced by the changeset — new findings only, known ones floored by the committed dead-code and health baselines, and the committed baselines are shrink-only; duplication and styling are reported but advisory (verdict-neutral)
    floor: fallow-dead-code
  - id: fallow-health
    run: npm run fallow:ratchet
    description: maintainability and CRAP ratchet — new complexity findings fail, known ones pass, and a stale health-baseline entry fails
    floor: fallow-health
  - id: fallow-dead-code-staleness
    run: npm run fallow:dead-code
    description: whole-project dead-code staleness — a committed dead-code-baseline entry that matches nothing fails
verify:
  - gate: fallow-audit
    scope: root
  - gate: fallow-dead-code-staleness
    scope: root
---

## Apply

1. **`.fallowrc.json`** — create from `templates/fallow-audit/.fallowrc.json`, the same config the Bun recipe writes: it is package-manager-neutral. `audit.gate: new-only` is what makes the audit usable on a repo with existing debt: it fails on issues the change *introduces*, not on the ones already there. `entry` names `stryker.conf.mjs`, which is referenced only by the Stryker CLI and would otherwise be reported as an unused file. `rules` sets `unresolved-imports` and `unlisted-dependencies` to `error` — the two categories fallow calls correctness issues, so they are never baselined — and promotes `stale-suppressions` from its `warn` default to `error` and `require-suppression-reason` from its `off` default to `error`, so a suppression that no longer suppresses anything and a suppression with no stated reason both fail. `failOnParseError: true` arms the parse-error gate: a file the parser could not read cleanly fails the run instead of only warning, because a file that was not parsed is a file that was not analyzed. `minimumVersion` names the fallow release the config is written for, so an older binary stops with a message naming both versions instead of failing on the first field it does not recognize.
2. **`package.json`** — merge from `templates/fallow-audit-npm/package.json`: add the `fallow` devDependency and the `fallow`, `fallow:audit`, `fallow:coverage`, `fallow:dead-code`, `fallow:ratchet` and `fallow:raise` scripts. `fallow:ratchet` is the health gate, `fallow:dead-code` is the whole-project dead-code staleness gate, and `fallow:raise` writes the two committed floor files `.fallow-health-baseline.json` and `.fallow-dead-code-baseline.json` (see the gate paragraph below).
3. **`.husky/pre-push`** — merge from `templates/fallow-audit-npm/pre-push.block`, inside this recipe's marker pair: the Bun recipe's block with `bun run fallow:audit` → `npm run fallow:audit`.
4. **The install** — `sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'`, installing `fallow`.
5. **`npm run fallow:raise`** — the adoption flow's baseline write for fallow's floors: it writes `.fallow-health-baseline.json` and `.fallow-dead-code-baseline.json` at the level the gates just measured, so `fallow:ratchet` and `fallow:audit` pass at the current level and the recipe is recorded. Run it after the commands phase (it needs the coverage artifact the test run produces) and before the verify. The floor never rises on its own: only `fallow:raise` (or the improvement skill) raises it.

   The raise then runs the project's formatter over the two files it just wrote — `biome check --write --unsafe --linter-enabled=false` on them, or `prettier --write` when Prettier is the selection's formatter — because fallow writes them in its own layout (unsorted keys, collapsed arrays, no trailing newline) and the `format:check` gate the same selection installs would otherwise fail on files the apply itself produced. The formatting lives in the script rather than in a second sweep after it, so the raise leaves the files formatter-stable wherever it runs: the apply's baseline write, and the improvement skill's `--raise`, which calls the same script and would otherwise commit unformatted baselines. The formatter is looked up on `PATH` (which `npm run` populates from `node_modules/.bin`); when neither is installed the raise still appends a trailing newline to each file, so the baselines end in a newline — the one thing every formatter agrees on — and a selection whose formatter is neither biome nor Prettier (dprint, say) does not fail its `format:check` on the newline-less file fallow writes.

**The Bun recipe's `scripts/lcov-to-istanbul.ts` bridge is deliberately not written here.** It exists because bun's coverage reporter emits only `text` and `lcov` while fallow's `--coverage` needs Istanbul JSON; Vitest's `istanbul` provider writes `coverage/coverage-final.json` directly, so `fallow` reads it with no conversion step. `fallow:coverage` therefore runs `test` and then `fallow`, with nothing in between.

This recipe requires `vitest-coverage`: `fallow:coverage` runs the test suite and then scores against the coverage it produces, so without that recipe there is no coverage to read. The detector reports the missing requirement as the failing reason rather than applying a half-wired audit.

`fallow:audit` is the changeset gate: `fallow audit` reviews the changed files for dead code, complexity, duplication and styling, and `--gate new-only` fails only on the error-severity findings the changeset introduces. In the pinned fallow 3.33.1 those are dead code and complexity — their rules default to `error` — so they are what the gate actually blocks. Duplication and styling are reported but verdict-neutral: duplication has no rule id to re-severity, and the `css-*` styling rules default to `warn`, so a changeset that introduces only duplication or styling findings exits 0 with verdict `warn`. Styling can be promoted to a gate by setting the `css-*` rules to `error` in `.fallowrc.json`; duplication cannot be gated at all in 3.33.1. The committed baselines floor the known ones — `.fallow-dead-code-baseline.json` for the dead-code sub-analysis and `.fallow-health-baseline.json` for the complexity one — so a changed file carrying a baselined finding passes and a new one fails. Each flag is added only when its file exists, because fallow exits 2 on a missing baseline file, so a greenfield repo with no baseline is gated exactly as before — the audit's `new-only` gate stays active, failing on the findings the changeset introduces, with no grandfathers. The health baseline is what keeps the audit from double-gating complexity: without it, the CRAP finding in the `stryker-mutation-vitest` recipe's own `stryker.conf.mjs` template — which the health baseline records — is attributed as introduced and fails the gate. The health *ratchet* is still `fallow:ratchet`'s job; the audit's complexity sub-analysis is floored by the same file, not a second threshold.

**The committed baselines are shrink-only.** When a baseline is loaded, the script also passes `--fail-on-baseline-growth --baseline-base <ref>`, which fails the run when the working-tree baseline has a key the same file at the base ref does not — the change that adds a finding and re-saves the baseline in the same commit. The base ref is `FALLOW_AUDIT_BASE` when set, else the merge-base with the remote default branch, else the current branch name; the flag is passed only when a baseline exists, because fallow exits 2 on `--fail-on-baseline-growth` with no baseline to compare. A baseline the base ref does not have is a new baseline and passes with a note, so the commit that first introduces the baseline is not growth.

**The audit's base is the merge-base with the branch's upstream, or with the remote default (`origin/HEAD`, `origin/main`, `origin/master`) when the branch has no upstream.** On a long-lived branch — or any branch whose upstream is `origin/main` — "the change" is the whole branch, so the audit reports every finding the branch carries, not the ones the last commit added. Pin the base when that is not what you want: `FALLOW_AUDIT_BASE=<ref> npm run fallow:audit` (or `fallow audit --base <ref>`), e.g. the remote sha the pre-push hook is pushing to. The gate description says "in the changeset" for exactly this reason. A target that is not a git repository at all has no base to detect — `fallow audit` exits 2 with `could not detect base branch` — so the apply target must be a git repo with at least one commit (one commit and no remote is enough: the audit reports `base_description: "local main"`). The plan surfaces this requirement: on a repo with no commits it warns under **Warnings** that the audit's base cannot be detected, so the consumer commits before the verify (or pins the base) instead of hitting the failure.

`fallow` (health) is a report, not a gate — the script passes `--report-only`, so it prints maintainability and CRAP risk and always exits 0; the CI workflow runs it as a non-blocking report, so a health regression never fails a build. The health *gate* is `fallow:ratchet`: `fallow health --baseline .fallow-health-baseline.json --fail-on-stale-baseline` — known findings pass (exit 0), new ones fail (exit 1), and a baseline entry that matched nothing fails (exit 1) — falling back to the plain gate while no baseline exists: `fallow health --coverage …` with no `--baseline` and no `--report-only`, which fails on any error-severity complexity finding (the greenfield wall), and prints the mode and the `fallow:raise` command that records the current level on stderr. `--min-score` must never be combined with `--baseline` in one invocation, because `--min-score` replaces the finding-driven exit code and would silently defeat the baseline. The dead-code baseline's staleness is the third gate, `fallow:dead-code-staleness`: `fallow:dead-code` runs `fallow dead-code --baseline .fallow-dead-code-baseline.json --fail-on-stale-baseline` over the whole project, because the audit is change-scoped by construction and cannot judge a whole-project baseline — an audit that loaded one reports `gate_outcomes["stale-baseline"]` as `skipped`, and `--fail-on-stale-baseline` never fires there. With no baseline file the script prints that there is nothing to check and exits 0. `fallow:raise` writes both baselines — `fallow health --report-only --save-baseline` (the `--report-only` keeps the raise at exit 0 while findings exist) and `fallow dead-code --save-baseline` — then runs the project's formatter over the two files it wrote (step 5), and fails closed when either file was not written; run the tests first (`npm run test`) so `coverage/coverage-final.json` exists for the health half.

## Idempotency

- `.fallowrc.json` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- `package.json` and `.husky/pre-push` are `merge`s: re-running replaces this recipe's marker block and re-adds only missing keys.
- `fallow:raise` is idempotent: re-running it rewrites the same two baselines from the same measured level, and the formatter leaves them byte-identical, so a re-run is a no-op.

## Undo

- Delete `.fallowrc.json`.
- Remove the `fallow` devDependency and the `fallow`, `fallow:audit`, `fallow:coverage`, `fallow:dead-code`, `fallow:ratchet` and `fallow:raise` scripts from `package.json` — only where this recipe added them.
- Delete `.fallow-health-baseline.json` and `.fallow-dead-code-baseline.json`.
- Remove the `code-quality:fallow-audit-npm` block from `.husky/pre-push`; delete the file if the block is all it holds.
- Run the project's install to drop the package.
