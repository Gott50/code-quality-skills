---
id: secret-scan
title: Credential scan — gitleaks over the staged diff, and in CI
purpose: Refuse a commit that stages a credential, and fail a PR that pushes one, with a pinned gitleaks.
when:
  requires: [{ file: package.json }]
cost: fast
priority: 15
files:
  - path: scripts/secret-scan.sh
    action: create
    scope: root
    template: templates/secret-scan/scripts/secret-scan.sh
  - path: .husky/pre-commit
    action: merge
    scope: root
    template: templates/secret-scan/pre-commit.block
  - path: .github/workflows/secret-scan.yml
    action: create
    scope: root
    template: templates/secret-scan/secret-scan.yml
commands:
  - run: sh scripts/secret-scan.sh --install
    scope: root
gates:
  - id: secret-scan
    run: sh scripts/secret-scan.sh --staged
    description: gitleaks over the staged diff — the same scan the pre-commit hook runs
verify:
  - gate: secret-scan
    scope: root
  - run: node -e 'const fs=require("node:fs"),L=fs.readFileSync(".github/workflows/secret-scan.yml","utf8").split("\n"),die=(m)=>{console.error(m);process.exit(1)};const jobs=(()=>{const i=L.findIndex((l)=>/^jobs:$/.test(l));if(i<0)die("no jobs");const o=[];for(let k=i+1;k<L.length;k++){const m=/^  (\S+):$/.exec(L[k]);if(m)o.push(m[1]);else if(/^\S/.test(L[k]))break;}return o;})();if(jobs.join()!=="secret-scan")die("jobs: "+jobs.join());const job=(n)=>{const i=L.findIndex((l)=>l==="  "+n+":");if(i<0)die("no "+n+" job");let e=L.length;for(let k=i+1;k<L.length;k++){if(/^ {0,2}\S/.test(L[k])){e=k;break;}}return L.slice(i+1,e).filter((l)=>!/^\s*#/.test(l)).join("\n");};const b=job("secret-scan");const steps=[...b.matchAll(/^\s*- name: (.+)$/gm)].map((m)=>m[1]);if(steps.join()!=="checkout,gitleaks")die("steps: "+steps.join());if(!/uses: actions\/checkout@v7/.test(b))die("no checkout pin");if(!/fetch-depth: 0/.test(b))die("no fetch-depth");if(!/uses: gitleaks\/gitleaks-action@v3/.test(b))die("no gitleaks pin");if(!/GITLEAKS_VERSION: 8\.30\.1/.test(b))die("no gitleaks version");'
    scope: root
---

## Apply

1. **`scripts/secret-scan.sh`** — create from `templates/secret-scan/scripts/secret-scan.sh`. The
   launcher, and the reason this recipe needs no package-manager variant: it fetches the pinned
   gitleaks release (8.30.1, sha256-verified per platform) into
   `${XDG_CACHE_HOME:-$HOME/.cache}/code-quality/gitleaks/8.30.1/` on first use and runs it. A hook
   cannot assume a package manager's runner — this recipe serves Bun, npm and pnpm alike — and a
   binary on `PATH` is a property of the machine, not of the repo, so the hook would work on one
   developer's laptop and not in CI. Modes: `--install` (fetch only), `--staged` (the hook and the
   gate), `--history` (every commit — a manual sweep of the past, and the local reproduction of the
   CI job, which is an Action and therefore CI-only).

   **Why gitleaks and not TruffleHog.** Both are the outline's own names, and both ship a binary and
   a GitHub Action. gitleaks wins on the pre-commit half: `gitleaks git --staged` scans the index
   against `HEAD` natively, which is exactly "the credential never enters a commit", while
   TruffleHog's git source enumerates commits, so a staged-but-uncommitted credential is not in its
   scan set. gitleaks is also a single static binary with no runtime, and its config format carries
   the allowlist a repo needs for its own test fixtures.

   **No scanner config is written**, because gitleaks needs none: its built-in ruleset is the
   default, and it picks up a repo-local `.gitleaks.toml` on its own (config precedence 4), so a repo
   that needs an allowlist for its own fixtures adds one without this recipe owning the file — and
   without the recipe's `create` reporting that repo's file as drift.

2. **`.husky/pre-commit`** — merge the block from `templates/secret-scan/pre-commit.block`. It runs
   the launcher's `--staged` mode and exits non-zero on a finding, so the commit is refused. The
   marker comments are `#`, which is a valid `sh` comment: `<!--` here is a redirection and a syntax
   error at every commit. The block lands after the formatter's (priority 15 < 50), so the scan sees
   the content the formatter re-staged — what the commit will actually carry.

3. **`.github/workflows/secret-scan.yml`** — create from `templates/secret-scan/secret-scan.yml`.
   Its **own** workflow file, never a block merged into `ci.yml`: attaching would need
   `requires: [{ recipe: ci-workflow }]` **or** `{ recipe: ci-workflow-npm }`, and the predicate
   language has no OR, so one edge would under-select the other package-manager variant. The job
   checks out with `fetch-depth: 0` and runs `gitleaks/gitleaks-action@v3`, which scans the commits
   the PR adds — the half the hook never sees, because `--no-verify` skips it. `GITLEAKS_VERSION`
   makes the Action install the same build the hook's pinned binary is, so the two halves cannot
   disagree about a finding. The Action needs `GITLEAKS_LICENSE` for an **organization** account and
   ignores it for a personal one; without it the job fails with the Action's own message, which is
   the correct outcome — a gate that cannot run must not report green.

4. **`commands`** — the `--install` entry fetches the pinned binary during the apply, so the plan
   shows the network fetch and the first commit is not the one that pays for it. The launcher
   fetches on demand anyway, so a skipped command is not a broken hook.

The gate is the pre-commit half: it is the same scan the hook runs, so a human can reproduce a hook
failure by hand. The full-history half is the CI job, and `--history` reproduces it locally. A repo
whose **past** already carries a credential is not blocked by the gate — the gate is change-scoped,
like `fallow:audit` — but `--history` will fail on it, and the fix is to rotate the credential and
rewrite the history, not to record a floor: this gate has none, by design.

**Scope split with `semgrep`.** This recipe owns credential detection and nothing else. Pattern-level
security findings — injection, unsafe APIs — belong to the `semgrep` recipe, whose ruleset must not
re-report what this scanner already owns: the same finding failing two gates costs the second one its
authority.

## Idempotency

- `scripts/secret-scan.sh` and `.github/workflows/secret-scan.yml` are `create`s: byte-identical on
  re-run, so a re-run is a no-op. A local edit shows as drift and is reported, not overwritten.
- The `.husky/pre-commit` block is a marker merge: a re-run replaces the lines between
  `code-quality:secret-scan:start` and `:end` and leaves the rest of the hook untouched. A hook that
  already runs the same scan without the marker is reported as a duplicate and the block is not
  appended, so the scan does not run twice.
- The binary cache is outside the repo and keyed by version, so a re-run reuses it and a version bump
  fetches beside it rather than over it. Nothing the recipe writes is gitignored: the cache is not in
  the repo.

## Undo

- Delete `scripts/secret-scan.sh`; delete `scripts/` if it is empty.
- Delete the `code-quality:secret-scan:start` … `:end` block from `.husky/pre-commit`; delete the file
  if it is empty.
- Delete `.github/workflows/secret-scan.yml`; delete `.github/workflows/` if it is empty.
- Remove the cached binary at `${XDG_CACHE_HOME:-$HOME/.cache}/code-quality/gitleaks/` if you want
  the disk back.
