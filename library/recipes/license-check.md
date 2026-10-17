---
id: license-check
title: License allowlist — a wall, plus an SBOM in CI
purpose: Fail on a dependency whose license is outside the allowlist, and publish the repo's dependency inventory as an SPDX build artifact.
when:
  requires: [{ file: package.json }]
cost: fast
priority: 15
files:
  - path: scripts/license-check.sh
    action: create
    scope: root
    template: templates/license-check/scripts/license-check.sh
  - path: package.json
    action: merge
    scope: root
    template: templates/license-check/package.json
  - path: .github/workflows/license-check.yml
    action: create
    scope: root
    template: templates/license-check/license-check.yml
commands:
  - run: sh -c 'if test -f bun.lock -o -f bun.lockb; then bun install; elif test -f pnpm-lock.yaml; then pnpm install --no-frozen-lockfile; else npm install; fi'
    scope: root
    showInPlan: false
gates:
  - id: license-check
    run: sh scripts/license-check.sh
    description: every installed dependency's license must be on the allowlist in scripts/license-check.sh — a wall, with no floor
verify:
  - gate: license-check
    scope: root
  - run: bun -e "const y = Bun.YAML.parse(await Bun.file('.github/workflows/license-check.yml').text()); if (Object.keys(y.jobs).join() !== 'license-check') process.exit(1); const j = y.jobs['license-check']; if (j.steps.map((s) => s.name).join() !== 'checkout,setup-node,setup-bun,install,license-check,sbom') process.exit(1); if (j.steps[0].uses !== 'actions/checkout@v7') process.exit(1); if (j.steps[1].uses !== 'actions/setup-node@v7') process.exit(1); if (j.steps[2].uses !== 'oven-sh/setup-bun@v2') process.exit(1); if (!j.steps[4].run.includes('sh scripts/license-check.sh')) process.exit(1); if (j.steps[5].uses !== 'anchore/sbom-action@v0') process.exit(1); if (j.steps[5].with.format !== 'spdx-json') process.exit(1); if (j.steps[5].if !== 'always()') process.exit(1)"
    scope: root
---

## Apply

1. **`scripts/license-check.sh`** — create from `templates/license-check/scripts/license-check.sh`.
   The gate, and the reason this recipe needs no package-manager variant: it runs the local
   `node_modules/.bin/license-checker` directly, so the same command works under Bun, npm and pnpm.
   The allowlist is the `ALLOW` variable in the script — `MIT`, `ISC`, `Apache-2.0`, `BSD-2-Clause`,
   `BSD-3-Clause`, `0BSD`, `Unlicense`, `CC0-1.0`, `Python-2.0`, `CC-BY-3.0` and
   `(MIT AND CC-BY-3.0)` — and a dependency outside it fails the run. The last two are there because
   license-checker's own SPDX data packages (`spdx-exceptions`, `spdx-ranges`) carry them and the
   scan covers devDependencies as well as dependencies; both are permissive, so they are allowed
   rather than excluded. `--excludePrivatePackages` keeps the repo's own package out of the scan: its license is
   the repo's, not a dependency's, and a private package usually declares none. The tool matches the
   license string it reports, so a dual-licensed package (`(MIT OR Apache-2.0)`) and a package with
   no license field (`UNKNOWN`) both fail until they are named in the allowlist — that is the wall
   working, not a false positive to silence.

2. **`package.json`** — merge from `templates/license-check/package.json`: add the
   `license-checker` devDependency. The merge adds it only where the project does not already
   declare it.

3. **`.github/workflows/license-check.yml`** — create from
   `templates/license-check/license-check.yml`. Its **own** workflow file, never a block merged into
   `ci.yml`: attaching would need `requires: [{ recipe: ci-workflow }]` **or**
   `{ recipe: ci-workflow-npm }`, and the predicate language has no OR, so one edge would
   under-select the other package-manager variant. One job, `license-check`, with six steps:
   - **checkout** — `actions/checkout@v7`.
   - **setup-node** — `actions/setup-node@v7` with a literal `node-version: 22`.
   - **setup-bun** — `oven-sh/setup-bun@v2`. The recipe is package-manager-agnostic, so the job
     installs with the manager the lockfile names; the runner carries node and npm, pnpm comes from
     corepack, and bun has to be set up.
   - **install** — `sh -c 'if test -f bun.lock -o -f bun.lockb; then bun install --frozen-lockfile;
     elif test -f pnpm-lock.yaml; then corepack enable && pnpm install --frozen-lockfile; else npm
     ci; fi'`. The lockfile is the same evidence the detector uses, and in CI it is committed, so
     the frozen form is correct here.
   - **license-check** — `sh scripts/license-check.sh`, the same wall the local gate runs.
   - **sbom** — `anchore/sbom-action@v0` with `format: spdx-json`, `output-file: sbom.spdx.json` and
     `artifact-name: sbom.spdx.json`. The inventory, not a gate: the step carries `if: always()` so
     the SBOM is still produced when the wall above fails, because the inventory is what you need in
     order to fix the failure. Syft reads the lockfile and the installed tree, so it needs no extra
     install step.

4. **The install** — `sh -c 'if test -f bun.lock -o -f bun.lockb; then bun install; elif test -f
   pnpm-lock.yaml; then pnpm install --no-frozen-lockfile; else npm install; fi'`. The contract's
   `run` is a literal command line and the three managers have no common install verb, so the recipe
   picks by the lockfile the detector already used to name the manager. It is an `if`/`elif`/`else`
   on the lockfile's **existence**, deliberately not the shorter `test -f pnpm-lock.yaml && pnpm
   install || npm install`: with the `||` form a *failing* install silently falls through to the
   next manager, which writes a second lockfile into the repo. `--no-frozen-lockfile` is required
   because this recipe *adds* a devDependency: pnpm defaults to a frozen lockfile whenever `CI` is
   set, and a frozen install refuses a `package.json` the lockfile does not yet describe
   (`ERR_PNPM_OUTDATED_LOCKFILE`) — the lockfile has to move for the new dependency to exist at all.

The gate is a wall, not a ratchet: it declares no `floor`, because "this license is not allowed" is
a decision the repo makes once, not a level it climbs. A repo that needs a license the allowlist
does not carry adds it to `ALLOW` deliberately — the allowlist is the policy, and widening it is the
reviewable act.

The recipe's `verify` is the gate itself plus the workflow-shape assertion: it parses the generated
workflow and asserts its job, its six step names, the three action pins, the wall step and the SBOM
step's format and `if: always()`. That assertion is the only seam that can see the CI half — the
library check's shell-syntax check covers `.husky/*` only, and a workflow template is skipped by
both the formatter and the linter.

## Idempotency

- `scripts/license-check.sh` and `.github/workflows/license-check.yml` are `create`s: byte-identical
  on re-run, so they are no-ops. A local edit shows as drift and is reported, not overwritten.
- `package.json` is a `merge`: re-running replaces this recipe's marker block and re-adds only
  missing keys.
- The SBOM is a CI artifact, not a repo file: nothing the recipe writes lands in the tree, so a
  re-run has nothing to reconcile.

## Undo

- Delete `scripts/license-check.sh`; delete `scripts/` if it is empty.
- Remove the `license-checker` devDependency from `package.json` — only where this recipe added it.
- Delete `.github/workflows/license-check.yml`; delete `.github/workflows/` if it is empty.
- Run the project's install to drop the package.
