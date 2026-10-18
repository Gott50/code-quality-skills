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
  - run: node -e 'const fs=require("node:fs"),L=fs.readFileSync(".semgrep/rules.yml","utf8").split("\n"),die=(m)=>{console.error(m);process.exit(1)};const ids=L.filter((l)=>/^  - id: /.test(l)).map((l)=>l.replace(/^  - id: /,""));if(ids.join()!=="no-eval,no-shell-string-in-child-process,no-sql-string-interpolation,no-unsafe-html-assignment,no-weak-hash,no-disabled-tls-verification")die("ids: "+ids.join());let inBlock=false;const body=[];for(const l of L){if(/^\s*#/.test(l))continue;if(/^    (message|metadata):/.test(l)){inBlock=true;continue;}if(inBlock&&/^ {0,4}\S/.test(l))inBlock=false;if(!inBlock)body.push(l);}if(/secret|token|api[_-]?key|password|credential|private[_-]?key|entropy/i.test(body.join("\n")))die("a rule pattern mentions a credential");'
    scope: root
  - run: node -e 'const fs=require("node:fs"),L=fs.readFileSync(".github/workflows/semgrep.yml","utf8").split("\n"),die=(m)=>{console.error(m);process.exit(1)};const jobs=(()=>{const i=L.findIndex((l)=>/^jobs:$/.test(l));if(i<0)die("no jobs");const o=[];for(let k=i+1;k<L.length;k++){const m=/^  (\S+):$/.exec(L[k]);if(m)o.push(m[1]);else if(/^\S/.test(L[k]))break;}return o;})();if(jobs.join()!=="semgrep")die("jobs: "+jobs.join());const job=(n)=>{const i=L.findIndex((l)=>l==="  "+n+":");if(i<0)die("no "+n+" job");let e=L.length;for(let k=i+1;k<L.length;k++){if(/^ {0,2}\S/.test(L[k])){e=k;break;}}return L.slice(i+1,e).filter((l)=>!/^\s*#/.test(l)).join("\n");};const b=job("semgrep");const steps=[...b.matchAll(/^\s*- name: (.+)$/gm)].map((m)=>m[1]);if(steps.join()!=="checkout,semgrep")die("steps: "+steps.join());if(!/uses: actions\/checkout@v7/.test(b))die("no checkout pin");if(!/image: semgrep\/semgrep:1\.181\.0/.test(b))die("no pinned image");if(!/--config \.semgrep\/rules\.yml/.test(b))die("no ruleset config");if(!/--error/.test(b))die("no --error");'
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
