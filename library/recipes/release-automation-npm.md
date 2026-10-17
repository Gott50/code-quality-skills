---
id: release-automation-npm
title: Release automation — commit-msg check, changelog and version derivation (npm/pnpm)
purpose: Reject a commit message the changelog cannot read, then derive the changelog and the next version from the history on main.
when:
  language: [typescript, javascript]
  packageManager: [npm, pnpm]
  workspace: any
  requires: [{ file: package.json }]
cost: fast
priority: 25
files:
  - path: scripts/commit-msg.sh
    action: create
    scope: root
    template: templates/release-automation-npm/scripts/commit-msg.sh
  - path: commitlint.config.mjs
    action: create
    scope: root
    template: templates/release-automation/commitlint.config.mjs
  - path: .husky/commit-msg
    action: merge
    scope: root
    template: templates/release-automation-npm/commit-msg.block
  - path: .github/workflows/release.yml
    action: create
    scope: root
    template: templates/release-automation/release.yml
  - path: release-please-config.json
    action: create
    scope: root
    template: templates/release-automation/release-please-config.json
  - path: .release-please-manifest.json
    action: create
    scope: root
    template: templates/release-automation/.release-please-manifest.json
  - path: package.json
    action: merge
    scope: root
    template: templates/release-automation-npm/package.json
commands:
  - run: sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'
    scope: root
    showInPlan: false
gates:
  - id: commit-msg
    run: sh scripts/commit-msg.sh .git/COMMIT_EDITMSG
    description: commitlint over a commit message — the same check the commit-msg hook runs
verify:
  - run: sh -c 'printf "added a thing\n" > /tmp/cq-commit-msg-bad.txt; if sh scripts/commit-msg.sh /tmp/cq-commit-msg-bad.txt; then echo "malformed message was accepted" >&2; exit 1; fi; printf "feat: add a thing\n" > /tmp/cq-commit-msg-good.txt; sh scripts/commit-msg.sh /tmp/cq-commit-msg-good.txt'
    scope: root
  - run: bun -e "const y = Bun.YAML.parse(await Bun.file('.github/workflows/release.yml').text()); const j = y.jobs.release; if (Object.keys(y.jobs).join() !== 'release') process.exit(1); if (!j) process.exit(1); if (j.steps.map((s) => s.name).join() !== 'checkout,release-please') process.exit(1); if (j.steps[0].uses !== 'actions/checkout@v7' || Number(j.steps[0].with['fetch-depth']) !== 0) process.exit(1); if (j.steps[1].uses !== 'googleapis/release-please-action@v4') process.exit(1); if (j.steps[1].with['config-file'] !== 'release-please-config.json' || j.steps[1].with['manifest-file'] !== '.release-please-manifest.json') process.exit(1)"
    scope: root
---

## Apply

The two changes land in this order. The commit-message check is first, because the changelog and
version derivation reads the commit history: a derivation over messages that do not conform is a
derivation over noise, so the check has to be in place before the workflow that consumes it.

1. **`scripts/commit-msg.sh`** — create from
   `templates/release-automation-npm/scripts/commit-msg.sh`. The launcher, and the reason this recipe
   is a pair with the Bun one: it drives the linter through the package manager's runner (`npx`
   here, `bunx` in the Bun twin), so the linter resolves the project's own `node_modules/.bin`
   rather than a global install. `npx` resolves the project's own `node_modules/.bin` under both npm
   and pnpm, so the one script serves both managers and the hook needs no per-manager branch. The
   message file is an **explicit argument**, never an implicit `.git/COMMIT_EDITMSG` default: the
   hook passes the path git hands it (`$1`), and the gate passes a file the caller wrote. An
   implicit default would make the gate depend on the repo's own state — on a fresh clone with one
   commit that file holds whatever was last committed, so the gate would pass or fail for a reason
   unrelated to the change under test. A missing argument or a missing file exits 2, which is a usage
   error, not a finding.

2. **`commitlint.config.mjs`** — create from `templates/release-automation/commitlint.config.mjs`,
   the same config the Bun recipe writes: commitlint's config is package-manager-neutral, so the two
   recipes share one template. `@commitlint/config-conventional` plus a 72-column header cap. The
   preset is the shape the derivation reads — a type, an optional scope, a subject — so the config
   the hook enforces and the config the changelog sections are written against are the same
   document.

3. **`.husky/commit-msg`** — merge the block from
   `templates/release-automation-npm/commit-msg.block`, inside this recipe's marker pair. It passes
   git's own `$1` through to the launcher and exits non-zero on a finding, so the commit is refused
   before the message is written. The marker comments are `#`, which is a valid `sh` comment: `<!--`
   here is a redirection and a syntax error at every commit. The block is duplicated from the Bun
   recipe rather than shared, because a marker block must name the recipe that owns it. The hook is
   inert until `husky` is installed and `prepare` is wired; `repo-hygiene-npm` owns that, and this
   recipe's `package.json` fragment does not repeat it.

4. **`.github/workflows/release.yml`** — create from `templates/release-automation/release.yml`, the
   same workflow the Bun recipe writes: the action is a JavaScript action and the job runs no
   package-manager command, so one file serves Bun, npm and pnpm alike. Its **own** workflow file,
   never a block merged into `ci.yml`: attaching would need `requires: [{ recipe: ci-workflow }]`
   **or** `{ recipe: ci-workflow-npm }`, and the predicate language has no OR, so one edge would
   under-select the other package-manager variant. The job checks out with `fetch-depth: 0` — the
   derivation walks the history from the last release tag, and a shallow clone has no history to walk
   — and runs `googleapis/release-please-action@v4`, which opens (or updates) one release PR
   carrying the changelog and the version bump. Merging that PR is the release; the tag and the
   GitHub release are created from it. `permissions` grants `contents: write` and
   `pull-requests: write`, which the action needs to push the release branch and open the PR.

5. **`release-please-config.json`** — create from
   `templates/release-automation/release-please-config.json`. `release-type: node` reads the version
   from `package.json` and writes it back; the `changelog-sections` list names the commit types the
   changelog prints and hides the ones it does not (`test`, `build`, `ci`, `chore`). The sections and
   the types the hook accepts are the same vocabulary, so a message the hook lets through is a
   message the changelog can place.

6. **`.release-please-manifest.json`** — create from
   `templates/release-automation/.release-please-manifest.json`. The action's record of the last
   released version per package; `0.0.0` is the greenfield state, and the action rewrites it on the
   release PR. It is committed, not generated at run time, because the derivation needs a starting
   point on the first run.

7. **`package.json`** — merge from `templates/release-automation-npm/package.json`: add the
   `@commitlint/cli` and `@commitlint/config-conventional` devDependencies and the `commit-msg`
   script, `sh scripts/commit-msg.sh`. Existing keys are never overwritten; a differing value is a
   collision the plan must show.

8. **The install** — `sh -c 'if test -f pnpm-lock.yaml; then pnpm install; else npm install; fi'`.
   The contract's `run` is a literal command line and the two managers have no common install verb,
   so the recipe picks by the lockfile the detector already used to name the manager. It is an
   `if`/`else` on the lockfile's **existence**, deliberately not the shorter
   `test -f pnpm-lock.yaml && pnpm install || npm install`: with the `||` form a *failing*
   `pnpm install` silently falls through to `npm install`, which writes a `package-lock.json` into a
   pnpm project.

The gate is the commit-message check: `sh scripts/commit-msg.sh .git/COMMIT_EDITMSG` runs the same
linter the hook runs, so a human can reproduce a hook failure by hand. The changelog and version
derivation is the CI half, and it is not a gate the project runs locally — it is a workflow that
opens a release PR, and the review of that PR is the human step. A repo whose **past** carries
non-conforming messages is not blocked by the gate — the gate is change-scoped, like `fallow:audit`
— but the derivation will classify those commits as untyped and leave them out of the changelog;
the fix is to conform from here on, not to record a floor: this gate has none, by design.

## Idempotency

- `scripts/commit-msg.sh`, `commitlint.config.mjs`, `.github/workflows/release.yml`,
  `release-please-config.json` and `.release-please-manifest.json` are `create`s: byte-identical on
  re-run, so a re-run is a no-op. A local edit shows as drift and is reported, not overwritten. The
  manifest is the one exception in spirit: the action rewrites it on the release PR, so a repo that
  has released shows it as drift, and the plan reports that rather than overwriting the released
  version with `0.0.0`.
- The `.husky/commit-msg` block is a marker merge: a re-run replaces the lines between
  `code-quality:release-automation-npm:start` and `:end` and leaves the rest of the hook untouched. A
  hook that already runs the same check without the marker is reported as a duplicate and the block
  is not appended, so the check does not run twice.
- `package.json` is a merge: re-running replaces this recipe's marker block and re-adds only missing
  keys.

## Undo

- Delete `scripts/commit-msg.sh`; delete `scripts/` if it is empty.
- Delete `commitlint.config.mjs`.
- Delete the `code-quality:release-automation-npm:start` … `:end` block from `.husky/commit-msg`;
  delete the file if it is empty.
- Delete `.github/workflows/release.yml`; delete `.github/workflows/` if it is empty.
- Delete `release-please-config.json` and `.release-please-manifest.json`.
- Remove the `@commitlint/cli` and `@commitlint/config-conventional` devDependencies and the
  `commit-msg` script from `package.json` — only where this recipe added them.
- Run the project's install to drop the packages.
