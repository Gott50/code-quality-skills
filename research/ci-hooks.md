---
topic: ci-hooks
question: >-
  What belongs in a pre-commit hook, what belongs in pre-push, and what belongs
  only in CI? Cover the fast/slow split, why a hook must be skippable, mutation
  on PRs vs. every push, and the failure mode of a hook that makes committing
  slow. Which are enforceable and which are judgement?
verdict: >-
  A hook is a convenience, never the enforcement. Git makes every client-side
  hook bypassable by design (`--no-verify` on both `git commit` and `git push`;
  husky's `HUSKY=0`), so the only non-bypassable place to enforce a gate is the
  server side — CI, made required by branch protection. The split follows the
  cost of the check, not its importance: pre-commit runs the fast gates
  (format, lint, typecheck, test), pre-push runs the slow ones (mutation, the
  dead-code audit), and CI runs everything on every PR. Mutation is the
  canonical slow gate: it is scoped to the changed files and run on PRs, not on
  every push, because a full-suite run per push is too slow to survive. The
  failure mode of a slow hook is not a slow commit — it is a skipped hook: a
  developer who learns that `git commit` costs minutes learns `--no-verify`, and
  the gate stops running for the person it was meant to protect. Enforceable:
  the fast/slow placement, the CI trigger split, the mutation scoping, the
  required check. Judgement: which gates are fast enough for pre-commit, whether
  a hook auto-fixes or fails, and whether to run mutation on every push.
sources:
  - https://git-scm.com/docs/githooks
  - https://git-scm.com/docs/git-commit
  - https://git-scm.com/docs/git-push
  - https://pre-commit.com/
  - https://pre-commit.ci/
  - https://typicode.github.io/husky/
  - https://typicode.github.io/husky/get-started.html
  - https://typicode.github.io/husky/how-to.html
  - https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
  - https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
  - https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
  - https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs
  - https://stryker-mutator.io/docs/
  - https://stryker-mutator.io/docs/stryker-js/incremental/
  - https://stryker-mutator.io/docs/stryker-js/configuration/
  - https://github.com/lint-staged/lint-staged
  - https://lefthook.dev/
  - library/RECIPE-CONTRACT.md
---

# CI hooks

## The fast/slow split

Git gives a hook exactly one lever: its exit status. `pre-commit` "is invoked by
git-commit[1], and can be bypassed with the `--no-verify` option … Exiting with a
non-zero status from this script causes the `git commit` command to abort before
creating a commit" ([git-scm.com/docs/githooks](https://git-scm.com/docs/githooks)).
`pre-push` "is called by git-push[1] and can be used to prevent a push from
taking place … If this hook exits with a non-zero status, `git push` will abort
without pushing anything" ([git-scm.com/docs/githooks](https://git-scm.com/docs/githooks)).
Neither hook knows anything about cost; the split is a design choice about how
much latency a developer will tolerate at each point.

The library's own split is exactly this, and it is visible in the templates:

- **pre-commit** — `biome-assist` (`biome check --staged --write`),
  `oxlint-anti-slop` (`bun run lint`), `tsconfig-strict` (`bun run typecheck`),
  `bun-test-coverage` (`bun run test`), and the npm siblings. All four are
  `cost: fast` recipes.
- **pre-push** — `stryker-mutation` / `stryker-mutation-vitest`
  (`bun scripts/mutation-gate.ts`) and `fallow-audit` / `fallow-audit-npm`
  (`bun run fallow:audit`). The mutation recipes are `cost: heavy`; the contract
  says `heavy` "marks a recipe whose `verify` is slow (mutation testing,
  full-suite coverage); the plan prints a warning beside it"
  (`library/RECIPE-CONTRACT.md` → `cost`).
- **CI** — `ci-workflow` / `ci-workflow-npm` run lint, typecheck, format and the
  coverage gate in the `ci` job, mutation in a separate `mutation` job, and the
  fallow health report in a third job.

The reason the fast gates are cheap is that they are scoped to the change, not
the repo. `biome check --staged` reads the index; `bun run test` runs the suite
the recipe installed. The reason mutation is not is that it is inherently
per-mutant: "Bugs, or *mutants*, are automatically inserted into your production
code. Your tests are run for each mutant" ([stryker-mutator.io/docs](https://stryker-mutator.io/docs/)).
That is a full test run per mutant, which is why Stryker's own docs frame
incremental mode as the answer to "mutation testing still takes time. You might
want to speed things up further for larger code bases, fast feedback, or
Continuous Integration (CI) scenarios"
([stryker-mutator.io/docs/stryker-js/incremental](https://stryker-mutator.io/docs/stryker-js/incremental/)).

The same logic is what `lint-staged` exists for: "running a task on a whole
project can be slow … Ultimately you only want to check files that will be
committed" ([github.com/lint-staged/lint-staged](https://github.com/lint-staged/lint-staged)).
A hook that runs a repo-wide check on every commit is the anti-pattern the
staged-file tools were built to avoid.

## Why a hook must be skippable

Skippability is not a concession the library makes; it is a property of git.
`git commit --no-verify` "Bypass[es] the pre-commit and commit-msg hooks"
([git-scm.com/docs/git-commit](https://git-scm.com/docs/git-commit)), and
`git push --no-verify` "Toggle[s] the pre-push hook … With `--no-verify`, the
hook is bypassed completely" ([git-scm.com/docs/git-push](https://git-scm.com/docs/git-push)).
Husky, the library's hook installer, documents the same escape hatches and adds
its own: `git commit -m "..." -n` skips hooks, `HUSKY=0 git ...` "Temporarily
disables all Git hooks", and a global `export HUSKY=0` in
`~/.config/husky/init.sh` disables them for a machine
([typicode.github.io/husky/how-to.html](https://typicode.github.io/husky/how-to.html)).
Husky's own summary: "Husky doesn't force Git hooks. It can be globally disabled
(`HUSKY=0`) or be opt-in if wanted"
([typicode.github.io/husky/get-started.html](https://typicode.github.io/husky/get-started.html)).

The pre-commit framework makes the same point from the other direction: "Not all
hooks are perfect so sometimes you may need to skip execution of one or more
hooks. pre-commit solves this by querying a SKIP environment variable … This
allows you to skip a single hook instead of `--no-verifying` the entire commit"
([pre-commit.com](https://pre-commit.com/)). The design goal is a *narrow* skip
(a single hook) rather than the blunt `--no-verify`, because the blunt one is
always available and always total.

The consequence for the library is that a hook can never be the enforcement
point. The enforcement point is the server side, where the developer has no
`--no-verify`. Git's server-side hooks are the mechanism — `pre-receive` "is
invoked by git-receive-pack[1] when it reacts to git push … If the hook exits
with non-zero status, none of the refs will be updated", and `update` "executes
once for each ref to be updated … Exiting with a non-zero status prevents
git-receive-pack from updating that ref"
([git-scm.com/docs/githooks](https://git-scm.com/docs/githooks)) — but the
library does not write server-side hooks; it writes a CI workflow, and CI is
made non-bypassable by branch protection, not by the workflow file. GitHub's own
docs state the coupling: "If a workflow is skipped due to branch filtering, path
filtering, or a commit message, then checks associated with that workflow will
remain in a 'Pending' state. A pull request that requires those checks to be
successful will be blocked from merging"
([docs.github.com/…/workflow-syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).

That is also why the library's `ci-drift` recipe is deliberately non-blocking:
its comment step is `continue-on-error: true` and the check's exit code is
ignored, "so a drift report is a signal, never a gate"
(`library/recipes/ci-drift.md`). A signal belongs in a comment; a gate belongs
in a required check.

## Mutation on PRs vs. every push

The library runs mutation in three places, and the placement is the answer to
this question:

1. **pre-push, scoped to the pushed files.** `scripts/mutation-gate.ts` "reads
   the pre-push hook's stdin (one line per pushed ref), diffs the pushed commits
   against the remote tip, and runs Stryker scoped to the changed files with
   `--incremental`" (`library/recipes/stryker-mutation.md`). The scoping is
   load-bearing: "A full-suite run on every push is far too slow"
   (`library/recipes/stryker-mutation.md`).
2. **CI, on PRs only.** The `mutation` job carries
   `if: github.event_name == 'pull_request'` and is fed the PR's head and base
   SHAs, "so the strongest gate is enforced on PRs, not only on local pushes"
   (`library/recipes/ci-workflow.md`). The workflow's own comment says the same:
   "the mutation gate on PRs only (it is the slowest)"
   (`library/templates/ci-workflow/ci.yml`).
3. **Not on every push to main.** The workflow triggers on `pull_request` and
   `push` to `main`; the `mutation` job's `if` excludes the push event, so a
   merge to main does not re-run it.

The reason is cost, and Stryker's incremental docs quantify the saving: with
`--incremental`, "StrykerJS will track the changes you make to your code and
tests and only runs mutation testing on the changed code", reusing results where
"a mutant was 'Killed'; the culprit test still exists, and it didn't change"
([stryker-mutator.io/docs/stryker-js/incremental](https://stryker-mutator.io/docs/stryker-js/incremental/)).
The docs' own example reuses 3731 of 3965 mutant results and runs 234. Even so,
"the dry run remains required" — the floor is a full test run before any mutant
runs, which is why the gate is not a pre-commit candidate.

Two mechanics matter for the CI placement:

- **`--mutate` on the command line replaces the config, it does not add to it.**
  "each option used on the command line will **completely replace** (**not**
  supplement !) whatever is defined in the config file for this particular
  parameter" ([stryker-mutator.io/docs/stryker-js/configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)).
  The gate therefore reads the config's own `mutate` globs and filters the
  changed files through them, rather than passing `--mutate` and silently
  dropping the config's scope (`library/recipes/stryker-mutation.md`).
- **A PR-only job needs the full history.** The `mutation` job checks out with
  `fetch-depth: 0` so the base SHA is present to diff against
  (`library/templates/ci-workflow/ci.yml`).

The alternative — mutation on every push — is what the library explicitly
rejects. The pre-push hook is the local approximation of the PR job, and it is
scoped to the pushed files for the same reason the PR job is scoped to the PR's
changes.

## The failure mode of a slow hook

The failure mode is not "commits are slow". It is that the hook stops running.
A developer who pays minutes per commit learns the escape hatch that git
documents in the same manual page as the hook itself: `--no-verify`. Once that
habit forms, the gate is gone for that developer, and it is gone silently — the
commit succeeds, the hook prints nothing, and nothing records that it was
skipped. The pre-commit framework's `SKIP` variable exists precisely to make the
skip narrow rather than total, but it cannot make the skip visible either
([pre-commit.com](https://pre-commit.com/)).

The second-order failure is worse than the first: a slow hook trains the team to
treat hooks as an obstacle, so the *fast* gates that would have caught a real
problem get skipped along with the slow one. `--no-verify` is all-or-nothing —
it bypasses "the pre-commit and commit-msg hooks"
([git-scm.com/docs/git-commit](https://git-scm.com/docs/git-commit)) — so one
slow hook poisons every hook in the file.

The library's design answers this in three ways:

- **Cost is a declared property.** `cost: heavy` is "Weight class only, never a
  duration", and the plan "prints a warning beside it"
  (`library/RECIPE-CONTRACT.md` → `cost`). The heavy recipes are the ones on
  pre-push, not pre-commit.
- **The heavy gate is scoped to the change.** The mutation gate diffs the pushed
  commits and runs only the changed files; the fallow audit's base is "the
  merge-base with the branch's upstream, or with the remote default"
  (`library/recipes/fallow-audit.md`), so it reviews the changeset, not the repo.
- **The heavy gate is not required for the fast ones to exist.** `ci-workflow`
  "deliberately does **not** require `stryker-mutation`", because requiring it
  "would cascade its absence into losing the whole workflow, which is worse than
  the red mutation gate it replaced" (`library/recipes/ci-workflow.md`). The
  mutation job's gate step is conditional on `scripts/mutation-gate.ts` existing,
  so a repo without the recipe still gets lint, typecheck, format and coverage.

The corollary for a hook author: if a check cannot finish in the time a
developer will tolerate at `git commit`, it does not belong in `pre-commit` —
and putting it there does not enforce it, it deletes it.

## Enforceable vs. judgement

**A gate can fail on it:**

- The fast gates in `pre-commit` — format, lint, typecheck, test. Each is a
  command with an exit status; the hook aborts the commit on non-zero.
- The slow gates in `pre-push` — mutation, the dead-code audit. Same mechanism,
  later in the flow.
- The CI trigger split — `pull_request` + `push` to main for the fast job,
  `if: github.event_name == 'pull_request'` for the mutation job.
- The mutation scoping — the gate diffs the pushed/PR commits and runs only the
  changed files, with `--incremental`.
- The required check — once branch protection requires the CI job, a skipped
  workflow leaves the check "Pending" and blocks the merge.

**Judgement, not gateable:**

- Which gates are fast enough for `pre-commit`. The contract's `cost` field
  records the decision; it does not make it.
- Whether a hook auto-fixes or fails. `lint-staged`'s default is to stage the
  changes ("changes made by tasks are automatically staged and added to the
  commit"), and `--fail-on-changes` "fail[s] with exit code 1 when tasks modify
  tracked files" ([github.com/lint-staged/lint-staged](https://github.com/lint-staged/lint-staged)).
  The library's `biome-assist` hook auto-fixes and re-stages with
  `git update-index --again`, guarded by a partially-staged check.
- Whether to run mutation on every push. The library says no; a repo with a
  small, fast suite could say yes.
- Whether the hook is skippable in practice. Git makes it skippable; the team
  decides whether that is acceptable.
- Whether to run hooks in parallel. `lefthook`'s example config sets
  `pre-commit: parallel: true` ([lefthook.dev](https://lefthook.dev/)); the
  library's husky hooks run serially, one marker block per recipe.

## Routing

| Practice | Enforceable? | Where it goes |
|---|---|---|
| Fast gates in `pre-commit` (format, lint, typecheck, test) | Yes — gate | `biome-assist` / `biome-assist-npm`, `oxlint-anti-slop` / `-npm`, `tsconfig-strict` / `-npm`, `bun-test-coverage` / `vitest-coverage` `.husky/pre-commit` blocks. Exists. |
| Slow gates in `pre-push` (mutation, dead-code audit) | Yes — gate | `stryker-mutation` / `stryker-mutation-vitest`, `fallow-audit` / `fallow-audit-npm` `.husky/pre-push` blocks. Exists. |
| Mutation scoped to the change, `--incremental` | Yes — gate | `stryker-mutation` `scripts/mutation-gate.ts` (reads the pre-push stdin, diffs the pushed commits). Exists. |
| Mutation on PRs, not every push | Yes — gate | `ci-workflow` / `ci-workflow-npm` `mutation` job (`if: github.event_name == 'pull_request'`, `fetch-depth: 0`). Exists. |
| Fast gates on every PR and push to main | Yes — gate | `ci-workflow` / `ci-workflow-npm` `ci` job. Exists. |
| Non-blocking signal (drift, health) | Yes — gate | `ci-drift` (sticky comment, `continue-on-error`); `ci-workflow` `fallow-coverage` job (`continue-on-error: true`). Exists. |
| Required status check (the only non-bypassable enforcement) | No — repo setting, not a file | `library/practices/ci-required-check.md` (the `ci-workflow` recipe writes the workflow but cannot set branch protection). |
| Hook installer (`prepare: husky`) | Yes — gate | `repo-hygiene` / `repo-hygiene-npm` `package.json` merge. Exists. |
| Which gates are fast enough for `pre-commit` | No — judgement | `library/practices/hook-cost-split.md` |
| Hook auto-fixes vs. fails on changes | No — judgement | `library/practices/hook-auto-stage.md` (shared with the formatting research) |
| Mutation on every push vs. PRs only | No — judgement | `library/practices/mutation-cadence.md` |
| Skippability / `--no-verify` policy | No — judgement | `library/practices/hook-skippability.md` |
| Parallel vs. serial hook execution | No — judgement | `library/practices/hook-parallelism.md` |
| A pre-push hook for the fast gates (currently absent) | Yes — gate, if wanted | New recipe or a `pre-push` block on the fast recipes: the library runs the fast gates in `pre-commit` and CI only, so a developer who commits with `--no-verify` and pushes without a pre-push fast gate reaches CI unchecked. |
