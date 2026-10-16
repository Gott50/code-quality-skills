---
topic: formatting
question: >-
  Why is a formatter gate a zero-diff wall rather than a floor? Cover
  format-on-write vs. check-in-CI, staged-only vs. repo-wide, generated files,
  and the interaction with a one-time repo-wide sweep. Which are enforceable
  and which are judgement?
verdict: >-
  A formatter is a total function, so its gate is a boolean — byte-identical to
  the formatter's output, or not — with no ratio to ratchet. That is a wall, not
  a floor, and it is the only gate in the library with no `floor` value. The
  wall is enforceable only repo-wide and check-only in CI; the local hook is a
  convenience that keeps the wall from firing, not the enforcement. Generated
  files must be excluded from the gate's file set or the gate fails forever on
  files the tool rewrites. The one-time sweep is what makes the wall reachable,
  and its scope must equal the gate's. Judgement, not gateable: format-on-write
  vs. check-only, staged-only vs. repo-wide locally, which files count as
  generated, and whether to sweep or narrow the gate.
sources:
  - https://biomejs.dev/reference/cli/
  - https://biomejs.dev/reference/configuration/
  - https://prettier.io/docs/cli
  - https://prettier.io/docs/ignore
  - https://prettier.io/docs/precommit
  - https://github.com/lint-staged/lint-staged
  - https://git-scm.com/docs/git-update-index
  - https://git-scm.com/docs/git-status
  - https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
  - library/RECIPE-CONTRACT.md
---

# Formatting

## Why a wall, not a floor

A formatter is a total function: for a given file and config there is exactly one
output. The check is therefore "is the file byte-identical to that output?" — a
boolean, not a ratio. Prettier's `--check` "will return exit code `1`" if any
matched file differs and `0` if all match; there is no partial credit
([prettier.io/docs/cli](https://prettier.io/docs/cli)). Biome's `--enforce-assist`
"Enforces assist actions and causes the command to fail if required actions are
not applied. Defaults to `true`" — so even the sorting half of the gate is a hard
fail ([biomejs.dev/reference/cli](https://biomejs.dev/reference/cli/)).

This is why the library's own contract singles it out: "A gate WITHOUT `floor` is
a wall at a fixed level — a formatter's zero-diff gate has no floor"
(`library/RECIPE-CONTRACT.md` → `gates`/`floor`). Coverage and mutation are
ratios with a recorded floor; a formatter has nothing to ratchet. You cannot
"improve" from 80% formatted to 100% — the first unformatted file fails the gate.
The only way to make it green is to make the whole checked set formatted, which
is what forces the one-time sweep (below).

## Format-on-write vs. check-in-CI

These are two different jobs, and the tools name them separately.

- **Format-on-write** mutates the worktree. Prettier's `--write` "rewrites all
  processed files in place" ([prettier.io/docs/cli](https://prettier.io/docs/cli)).
  Biome's `--write`/`--fix` "Applies formatting changes, safe lint fixes, and safe
  assist actions" ([biomejs.dev/reference/cli](https://biomejs.dev/reference/cli/)).
- **Check-in-CI** never modifies files and exits non-zero. Biome's `biome ci`
  "Runs formatting checks, linting checks, and assist actions in CI without
  modifying files" ([biomejs.dev/reference/cli](https://biomejs.dev/reference/cli/)).

Biome's own scope guidance maps the two: `--staged` "Checks only staged files.
This option is intended for local use", while `--changed` "Checks only files with
committed changes … This option is intended for CI"
([biomejs.dev/reference/cli](https://biomejs.dev/reference/cli/)).

The library wires both, and the split is deliberate. `biome-assist`'s pre-commit
block runs `biome check --staged --write` (format-on-write, staged-only), while
its `format:check` gate runs `biome check .` (check-only, repo-wide)
(`library/templates/biome-assist/pre-commit.block`,
`library/templates/biome-assist/package.json`). Prettier's docs state the
relationship plainly: "To minimise the number of times `prettier --check` finds
unformatted files, you may be interested in configuring a pre-commit hook …
Applying this practice will minimise the number of times the CI fails because of
code formatting problems"
([prettier.io/docs/precommit](https://prettier.io/docs/precommit)). The hook is a
convenience; the CI check is the enforcement.

Note the library's two formatter recipes differ here. `eslint-prettier`'s hook
runs `npm run lint` and `npm run format:check` — check-only, repo-wide, no
`--write` (`library/templates/eslint-prettier/pre-commit.block`). Only
`biome-assist`/`biome-assist-npm` format on write.

Enforcement is a repo setting, not a file: GitHub requires that "Required status
checks must have a `successful`, `skipped`, or `neutral` status before
collaborators can make changes to a protected branch"
([docs.github.com](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
The library can write the workflow (`ci-workflow`), but it cannot set branch
protection.

## Staged-only vs. repo-wide

Staged-only is a local optimization, not a gate. It sees only the index, so it
cannot catch a file that was never staged — a file committed by another author,
or one the hook skipped. Biome marks `--staged` "intended for local use"
([biomejs.dev/reference/cli](https://biomejs.dev/reference/cli/)). A gate must be
repo-wide: the library's contract states "A one-time sweep's scope MUST equal the
gate's scope. A repo-wide gate (`biome check .`) needs a repo-wide sweep"
(`library/RECIPE-CONTRACT.md` → `commands`).

Staged-only also carries a correctness hazard that repo-wide does not. `--staged
--write` rewrites the worktree, so re-staging a file that also has unstaged
changes would commit a blend of reviewed and unreviewed content. The library's
guard refuses the commit when any file shows a non-empty character in **both**
the index and worktree columns (`MM`, `AM`): `git status --short | grep -qE
'^[^ ?][^ ?]'` (`library/templates/biome-assist/pre-commit.block`). Git's short
format defines those columns: "`X` shows the status of the index and `Y` shows
the status of the working tree", and untracked paths are `??`
([git-scm.com/docs/git-status](https://git-scm.com/docs/git-status)).

The re-stage is `git update-index --again`, which "Runs *git update-index* itself
on the paths whose index entries are different from those of the `HEAD` commit"
([git-scm.com/docs/git-update-index](https://git-scm.com/docs/git-update-index)) —
it re-adds only paths already in the index and never sweeps in unstaged hunks.
`lint-staged` solves the same problem differently: it "creates a `git stash` as a
backup of the original state before running any configured tasks", and by default
hides unstaged changes from partially staged files (`--no-hide-partially-staged`
disables that) ([github.com/lint-staged/lint-staged](https://github.com/lint-staged/lint-staged)).

## Generated files

A formatter gate is only as good as its ignore set. A generated file that the
gate checks but the generator rewrites unformatted is permanent drift: the gate
fails on every run, and no amount of formatting fixes it.

Prettier: `.prettierignore` "uses gitignore syntax", and "It's recommended to
have a `.prettierignore` in your project! This way you can run `prettier --write
.` to make sure that everything is formatted (without mangling files you don't
want, or choking on generated files)." Prettier also reads `.gitignore` by
default ([prettier.io/docs/ignore](https://prettier.io/docs/ignore)).

Biome has two exclusion strengths and a per-path override:

- `vcs.useIgnoreFile` (default `false`) "Controls whether Biome applies patterns
  from `.gitignore`, Git's local `.git/info/exclude`, and supported `.ignore`
  files, including nested ignore files"
  ([biomejs.dev/reference/configuration](https://biomejs.dev/reference/configuration/)).
- In `files.includes`, `!pattern` excludes and `!!pattern` force-ignores: "To
  ensure that a path is never indexed, use a force-ignore pattern." The docs add
  "Prefer a regular exclusion for generated source files that provide types or
  other project information"
  ([biomejs.dev/reference/configuration](https://biomejs.dev/reference/configuration/)).
- `overrides` applies settings to matched files, so a single action can be turned
  off for a path
  ([biomejs.dev/reference/configuration](https://biomejs.dev/reference/configuration/)).

The library's precedent: the `biome-assist` template turns `useSortedKeys` off
for `**/package.json` (the package manager writes its own key order), and the
`.gitignore` block lists `skills-lock.json` (the skills CLI rewrites it unsorted
on every `skills add`), which Biome skips via `vcs.useIgnoreFile`
(`library/templates/biome-assist/biome.json`,
`library/templates/biome-assist/gitignore.block`). The exemption rides
`.gitignore` rather than the template's own `biome.json` because a `create`
target the repo has customized is never overwritten, so an `overrides` entry in
the template cannot reach a customized repo (`library/recipes/biome-assist.md`).

## The one-time repo-wide sweep

Turning a formatter on makes every previously unformatted file a failure,
including files the recipe never wrote, so the gate cannot pass until the repo is
swept once (`library/recipes/biome-assist.md`). The sweep is a `commands` entry,
not a `gates` entry: it runs once during apply, and the contract requires it be
shown — "Any command that touches files the recipe did not author — a first
format sweep is the common case — MUST be shown"
(`library/RECIPE-CONTRACT.md` → `commands`).

The sweep must run after **every** selected recipe's files are written, not only
its own. Other recipes merge new keys into `package.json`, and a JSON `merge`
appends the leaves its fragment names; if the sweep ran before those merges, the
merged manifest would never be sorted and the formatter's own `verify` would fail
on the state the run just produced. The contract's three phases (files, commands,
verify) are what make this safe: "no recipe's command runs until the last
selected recipe's files are written"
(`library/RECIPE-CONTRACT.md` → Apply order).

The sweep is not reversible: "The sweep is not reversible: the formatted files
stay formatted" (`library/recipes/biome-assist.md` → Undo). It is idempotent by
construction — a second run finds nothing to fix.

## Enforceable vs. judgement

**A gate can fail on it:**

- The zero-diff check itself, repo-wide and check-only in CI.
- The ignore set: a file the tool rewrites that is not excluded fails the gate.
- The sweep scope: the recipe's own `verify` cannot pass unless the sweep covered
  everything the gate checks.
- CI enforcement, once branch protection requires the check.

**Judgement, not gateable:**

- Format-on-write in a hook vs. check-only in CI.
- Staged-only vs. repo-wide for the local hook.
- Which files count as generated and should be excluded.
- Whether to run the one-time sweep or narrow the gate to new files.
- Whether the hook auto-stages its changes or fails on them (`lint-staged`'s
  `--fail-on-changes` "fail[s] with exit code 1 when tasks modify tracked files",
  vs. the default "changes made by tasks are automatically staged and added to
  the commit" — [github.com/lint-staged/lint-staged](https://github.com/lint-staged/lint-staged)).

## Routing

| Practice | Enforceable? | Where it goes |
|---|---|---|
| Repo-wide zero-diff format check in CI | Yes — gate | `biome-assist` / `biome-assist-npm` gate `format-check` (`biome check .`); `eslint-prettier` gate `format-check` (`prettier --check .`). Exists. |
| Format-on-write pre-commit hook, staged-only | Yes — gate | `biome-assist` / `biome-assist-npm` `.husky/pre-commit` block (`biome check --staged --write`). Exists. |
| Partially-staged guard + `git update-index --again` re-stage | Yes — gate | `biome-assist` / `biome-assist-npm` `.husky/pre-commit` block. Exists. |
| Generated-file exclusion from the gate's file set | Yes — gate | `biome-assist` `.gitignore` block + `vcs.useIgnoreFile`; `overrides` for `**/package.json`. Exists for the two known cases. A repo with other generated files needs a new template — a `format-ignore` recipe merging a `.prettierignore` / `biome.json` `files.includes` block — or the practice below. |
| One-time repo-wide sweep, scope = gate scope | Yes — gate | `biome-assist` / `biome-assist-npm` `commands` entry. Exists. |
| CI required status check | No — repo setting, not a file | `library/practices/ci-required-check.md` (the `ci-workflow` recipe writes the workflow but cannot set branch protection). |
| Format-on-write vs. check-only | No — judgement | `library/practices/format-on-write-vs-check.md` |
| Staged-only vs. repo-wide local hook | No — judgement | `library/practices/staged-vs-repo-wide.md` |
| Which files count as generated | No — judgement | `library/practices/generated-files.md` |
| Sweep vs. narrow the gate | No — judgement | `library/practices/one-time-sweep.md` |
| Hook auto-stages vs. fails on changes | No — judgement | `library/practices/hook-auto-stage.md` |
