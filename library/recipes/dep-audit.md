---
id: dep-audit
title: Dependency audit — the advisory ratchet, and the Renovate config
purpose: Fail a change that adds a dependency advisory, with a pinned lockfile scanner and a committed count floor.
when:
  requires: [{ file: package.json }]
cost: fast
priority: 15
files:
  - path: osv-scanner.toml
    action: create
    scope: root
    template: templates/dep-audit/osv-scanner.toml
  - path: scripts/dep-audit-gate.mjs
    action: create
    scope: root
    template: templates/dep-audit/scripts/dep-audit-gate.mjs
  - path: renovate.json
    action: create
    scope: root
    template: templates/dep-audit/renovate.json
  - path: .github/workflows/dep-audit.yml
    action: create
    scope: root
    template: templates/dep-audit/dep-audit.yml
commands: []
gates:
  - id: dep-audit
    run: node scripts/dep-audit-gate.mjs
    description: osv-scanner over the lockfiles — the advisory count must not exceed the floor recorded in .code-quality-baseline.json (0 with no baseline)
    floor: dep-audit
verify:
  - run: node scripts/dep-audit-gate.mjs --check
    scope: root
  - run: bun -e "const y = Bun.YAML.parse(await Bun.file('.github/workflows/dep-audit.yml').text()); const j = y.jobs['dep-audit']; if (Object.keys(y.jobs).join() !== 'dep-audit') process.exit(1); if (!j) process.exit(1); if (j.steps.map((s) => s.name).join() !== 'checkout,setup-node,dep-audit') process.exit(1); if (j.steps[0].uses !== 'actions/checkout@v7') process.exit(1); if (j.steps[1].uses !== 'actions/setup-node@v7' || String(j.steps[1].with['node-version']) !== '22') process.exit(1); if (j.steps[2].run !== 'node scripts/dep-audit-gate.mjs') process.exit(1)"
    scope: root
---

## Apply

1. **`osv-scanner.toml`** — create from `templates/dep-audit/osv-scanner.toml`. The scanner's
   config, and the repo's advisory ignore list: an advisory the repo has decided to accept is
   recorded here with a reason and an expiry, so the decision is visible in the diff and expires on
   its own. The gate passes `--config=./osv-scanner.toml` explicitly, because a config file applies
   only to lockfiles in its own directory and does not propagate to child directories — without the
   flag a workspace member's lockfile would be scanned with no config at all. The file carries no
   severity threshold: the scanner's config has no such key (its keys are the ignore list and
   package overrides), so a severity threshold is a scan-time concern, not a config one.

2. **`scripts/dep-audit-gate.mjs`** — create from
   `templates/dep-audit/scripts/dep-audit-gate.mjs`. The gate, and the reason this recipe needs no
   package-manager variant: it drives a **lockfile-reading scanner** (osv-scanner) rather than
   `npm audit`, so it scans whatever lockfile the repo carries — `bun.lock`, `package-lock.json`,
   `pnpm-lock.yaml` — and one file serves Bun, npm and pnpm alike. The scanner is not a dependency
   of the project, and a binary on `PATH` is a property of the machine, not of the repo, so the gate
   fetches the pinned release (2.7.0, sha256-verified per platform) into
   `${XDG_CACHE_HOME:-$HOME/.cache}/code-quality/osv-scanner/2.7.0/` on first use and runs it from
   there.

   **The floor is read from the unified baseline, not from a per-tool file.** The gate reads
   `gates.dep-audit.global` from `.code-quality-baseline.json` — the same committed floor file
   `score.mjs --raise` writes for `lint` and `typecheck` — and the count must not exceed it. With no
   baseline, or a baseline whose `dep-audit` gate was never raised, the floor is 0, the greenfield
   wall. This is the spec's deliberate rejection of the fallow precedent: fallow's floors live in its
   own files because fallow writes them itself, and the library's own raise step owns the level of a
   gate the library installs. An unreadable baseline fails the gate rather than silently becoming 0.

   **The report is normalized to the shape `score.mjs` reads.** The scanner's own JSON has no
   top-level `findings` — it nests `results[].packages[].vulnerabilities[]` — so the gate flattens
   it to `{ findings: [...] }`, one entry per advisory occurrence (the same advisory against two
   lockfile entries is two findings, so a "fix one of them" change moves the count), and writes
   `reports/dep-audit.json`. `score.mjs`'s reader expects exactly that shape and throws otherwise.

   **Modes.** The default mode scans, writes the report and compares. `--check` is the dry run: it
   scans nothing, reads the report that already exists and compares it against the floor — the mode
   the recipe's `verify` uses (see the network note below). `--report <path>` and
   `--baseline <path>` point the gate at a different report and floor, which is how the ratchet is
   exercised without a scan.

3. **`renovate.json`** — create from `templates/dep-audit/renovate.json`. The other half of the
   advisory story: the gate fails on an advisory a change adds, and Renovate fixes the ones that are
   already there by small, frequent upgrades rather than a batch. `vulnerabilityAlerts` opens a PR
   for a security advisory as soon as it is published, `lockFileMaintenance` keeps the lockfile
   fresh, and the `packageRules` entry automerges patch and minor updates so the routine upgrades do
   not queue behind review. The config is inert until the Renovate app (or a self-hosted runner) is
   installed on the repository — a file cannot install an app, so that step is manual.

4. **`.github/workflows/dep-audit.yml`** — create from `templates/dep-audit/dep-audit.yml`. Its
   **own** workflow file, never a block merged into `ci.yml`: attaching would need
   `requires: [{ recipe: ci-workflow }]` **or** `{ recipe: ci-workflow-npm }`, and the predicate
   language has no OR, so one edge would under-select the other package-manager variant. The job
   checks out, sets up node, and runs the same gate script the repo runs locally, so the count CI
   compares is the count the committed baseline records — a new advisory fails the PR that
   introduces it. The gate fetches the pinned scanner itself and fails loudly when the advisory
   database is unreachable, so a green run always means the database was read.

**The network resolution: the `verify` is a dry run.** The gate's real mode reaches the network (the
advisory database), and every other recipe's `verify` is offline. The recipe's `verify` therefore
runs the gate in `--check` mode, which proves the wiring — the script runs, the baseline path
resolves, the comparison is reachable — without the database, and exits 0 on a fresh repo whose
report does not exist yet. The comparison itself is proven by the ratchet test (a scratch report and
baseline pair), not by the verify. The gate's default mode is the opposite: it **fails loudly
(non-zero)** when the scanner cannot run or produces no output, so a gate that cannot reach the
database never reports green. The recipe is not recorded on a verify that passed for the wrong
reason: the dry run says so in its own output, and the real gate is the one the project runs.

## Idempotency

- `osv-scanner.toml`, `scripts/dep-audit-gate.mjs`, `renovate.json` and
  `.github/workflows/dep-audit.yml` are `create`s: byte-identical on re-run, so a re-run is a no-op.
  A local edit shows as drift and is reported, not overwritten.
- The scanner cache is outside the repo and keyed by version, so a re-run reuses it and a version
  bump fetches beside it rather than over it. Nothing the recipe writes is gitignored: the cache is
  not in the repo.
- The gate rewrites `reports/dep-audit.json` from the same scan, so a re-run produces the same
  bytes. The report is a build artifact, not a committed file.

## Undo

- Delete `osv-scanner.toml`, `renovate.json` and `scripts/dep-audit-gate.mjs`; delete `scripts/` if
  it is empty.
- Delete `.github/workflows/dep-audit.yml`; delete `.github/workflows/` if it is empty.
- Delete `reports/dep-audit.json`; delete `reports/` if it is empty.
- Remove the cached scanner at `${XDG_CACHE_HOME:-$HOME/.cache}/code-quality/osv-scanner/` if you
  want the disk back.
