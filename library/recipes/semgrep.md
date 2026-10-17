---
id: semgrep
title: Semgrep — pattern-level security findings, in CI and on demand
purpose: Fail on injection and unsafe-API patterns with a vendored semgrep ruleset, in its own CI workflow and through a launcher that needs no project install.
when:
  requires: [{ file: package.json }]
cost: fast
priority: 15
files:
  - path: .semgrep/rules.yml
    action: create
    scope: root
    template: templates/semgrep/rules.yml
  - path: scripts/semgrep.sh
    action: create
    scope: root
    template: templates/semgrep/scripts/semgrep.sh
  - path: .github/workflows/semgrep.yml
    action: create
    scope: root
    template: templates/semgrep/semgrep.yml
commands: []
gates:
  - id: semgrep
    run: sh scripts/semgrep.sh
    description: semgrep over the repo with the vendored ruleset — injection and unsafe APIs; credential detection belongs to the secret-scan gate
verify:
  - run: bun -e "const y = Bun.YAML.parse(await Bun.file('.semgrep/rules.yml').text()); const ids = y.rules.map((r) => r.id).join(); if (ids !== 'no-eval,no-shell-string-in-child-process,no-sql-string-interpolation,no-unsafe-html-assignment,no-weak-hash,no-disabled-tls-verification') process.exit(1); const patterns = JSON.stringify(y.rules.map(({ message, metadata, ...rest }) => rest)); if (/secret|token|api[_-]?key|password|credential|private[_-]?key|entropy/i.test(patterns)) process.exit(1)"
    scope: root
  - run: bun -e "const y = Bun.YAML.parse(await Bun.file('.github/workflows/semgrep.yml').text()); if (Object.keys(y.jobs).join() !== 'semgrep') process.exit(1); const j = y.jobs.semgrep; if (j.steps.map((s) => s.name).join() !== 'checkout,semgrep') process.exit(1); if (j.steps[0].uses !== 'actions/checkout@v7') process.exit(1); if (j.container.image !== 'semgrep/semgrep:1.181.0') process.exit(1); if (!j.steps[1].run.includes('--config .semgrep/rules.yml') || !j.steps[1].run.includes('--error')) process.exit(1)"
    scope: root
---

## Apply

1. **`.semgrep/rules.yml`** — create from `templates/semgrep/rules.yml`. Six rules, all `ERROR`:
   `no-eval`, `no-shell-string-in-child-process`, `no-sql-string-interpolation`,
   `no-unsafe-html-assignment`, `no-weak-hash`, `no-disabled-tls-verification`. They are the
   pattern-level half of security — injection and unsafe APIs — and they are deliberately **not**
   credential detection: `secret-scan` owns that (gitleaks over the staged diff and the history),
   and a finding that fails two gates costs the second one its authority. The ruleset is vendored
   rather than fetched from the semgrep registry (`p/security-audit`, `--config auto`): a registry
   pack is resolved at scan time, so the gate would not be reproducible, would not run offline, and
   the "no credential rule" property would not be inspectable in the repo.

2. **`scripts/semgrep.sh`** — create from `templates/semgrep/scripts/semgrep.sh`. The gate, and the
   reason this recipe needs no package-manager variant: semgrep is a Python tool with no static
   binary release, so the launcher runs a pinned version (1.181.0) through a runner the machine
   already has — `uvx`, then `pipx run`, then a `semgrep` on `PATH` — and installs nothing into the
   project. It scans the whole repo with the vendored ruleset, `--error` so a finding fails the run
   and `--metrics=off` so the scan reports to nobody. A machine with none of the three runners fails
   with a message naming the prerequisite: a gate that cannot run must not report green.

3. **`.github/workflows/semgrep.yml`** — create from `templates/semgrep/semgrep.yml`. Its **own**
   workflow file, never a block merged into `ci.yml`: attaching would need
   `requires: [{ recipe: ci-workflow }]` **or** `{ recipe: ci-workflow-npm }`, and the predicate
   language has no OR, so one edge would under-select the other package-manager variant. One job,
   `semgrep`, running in the official `semgrep/semgrep:1.181.0` image — the same version the
   launcher pins, so the two halves cannot disagree about a finding — with `actions/checkout@v7` and
   one step that runs `semgrep scan --config .semgrep/rules.yml --error --metrics=off`. The vendored
   ruleset means the job needs no registry access and no `SEMGREP_APP_TOKEN`.

The gate is the local half: `sh scripts/semgrep.sh` runs the same ruleset the CI job runs, so a
finding is reproducible by hand. The CI half is the non-bypassable one — a hook is a convenience and
every hook is bypassable — and the recipe's `verify` parses the generated workflow and asserts its
job, its step names, the pinned image and the scan flags, because the library check's shell-syntax
check covers `.husky/*` only and a workflow template is skipped by both the formatter and the
linter. The `verify` also asserts the ruleset's rule ids and that no rule's patterns mention a
credential shape, which is the mechanical form of the scope split above.

**Scope split with `secret-scan`.** This recipe owns pattern-level security findings and nothing
else. Credential detection — a committed key, token or password — belongs to `secret-scan`, whose
gitleaks scan runs over the staged diff and the history. The two rulesets are disjoint by
construction: the check is that no rule here matches a credential, and the evidence is that a file
full of credentials produces zero findings from this ruleset while gitleaks reports them.

## Idempotency

- `.semgrep/rules.yml`, `scripts/semgrep.sh` and `.github/workflows/semgrep.yml` are `create`s:
  byte-identical on re-run, so they are no-ops. A local edit shows as drift and is reported, not
  overwritten.
- The launcher installs nothing into the repo: `uvx`/`pipx` cache the pinned semgrep outside it, so
  a re-run reuses the cache and a version bump fetches beside it rather than over it.
- A repo that wants its own rules adds them to `.semgrep/rules.yml`; the file is a `create`, so the
  edit is reported as drift rather than silently reverted.

## Undo

- Delete `.semgrep/rules.yml`; delete `.semgrep/` if it is empty.
- Delete `scripts/semgrep.sh`; delete `scripts/` if it is empty.
- Delete `.github/workflows/semgrep.yml`; delete `.github/workflows/` if it is empty.
- Remove the cached semgrep from the `uvx`/`pipx` cache if you want the disk back.
