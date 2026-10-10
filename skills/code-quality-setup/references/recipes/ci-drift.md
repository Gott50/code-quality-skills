---
id: ci-drift
title: CI drift report — one sticky, non-blocking PR comment
purpose: Post the skill's drift report as one sticky, non-blocking comment on every PR.
when:
  language: [typescript]
  workspace: any
  requires: [{ file: package.json }, { file: .agents/skills/code-quality-setup/scripts/plan.mjs }]
cost: fast
priority: 20
files:
  - path: .github/workflows/code-quality-drift.yml
    action: create
    scope: root
    template: templates/ci-drift/code-quality-drift.yml
commands: []
gates: []
verify:
  - run: node -e 'const fs=require("node:fs"),s=fs.readFileSync(".github/workflows/code-quality-drift.yml","utf8"),L=s.split("\n"),die=(m)=>{console.error(m);process.exit(1)};if(!/^on:$/m.test(s)||!/^  pull_request:$/m.test(s))die("no pull_request trigger");if(!/^  contents:[ ]read$/m.test(s)||!/^  pull-requests:[ ]write$/m.test(s))die("permissions must grant contents read and pull-requests write");const j=L.findIndex((l)=>/^jobs:$/.test(l));if(j<0)die("no jobs key");const n=L.slice(j+1).filter((l)=>/^  \S+:$/.test(l)).length;if(n!==1)die("expected 1 job, found "+n);const k=L.filter((l)=>/^      - /.test(l)).length;if(k!==4)die("expected 4 steps, found "+k);const w=["actions/checkout","actions/setup-node","plan.mjs --check","sticky-pull-request-comment"];let i=0;for(const l of L)if(i<w.length&&l.includes(w[i]))i++;if(i!==w.length)die("step order wrong, missing "+w.slice(i).join(", "));if(!/plan\.mjs --check.*\|\| true/.test(s))die("the check step must ignore the exit code")'
    scope: root
---

## Apply

1. **`.github/workflows/code-quality-drift.yml`** — create from `templates/ci-drift/code-quality-drift.yml`. One job, four steps:
   - **checkout** — `actions/checkout@v7`.
   - **setup-node** — `actions/setup-node@v7` with a literal `node-version: 22`. The job runs `node` only, so there is no install step and no package-manager split: one file serves Bun, npm and pnpm alike.
   - **render** — `node .agents/skills/code-quality-setup/scripts/plan.mjs --check > drift.json || true`. The `|| true` is the point: `--check` exits 1 whenever the report is not clean (drift, or a degraded report with no manifest), and the job is non-blocking. A second `node -e` reads `drift.json`; when it is the JSON document it writes the `markdown` field to `drift-comment.md` and sets the `present` output. Stdout that is not the JSON document — the unsupported path prints a sentence and exits 0 — leaves `present=false`, and the comment step is skipped.
   - **comment** — `marocchino/sticky-pull-request-comment@v2` with `header: code-quality-drift` and `path: drift-comment.md`, gated on `present == 'true'` and `continue-on-error: true`.

   The comment is one sticky comment per PR: the action embeds the `header` as a marker in the body and finds and updates that comment in place, so the workflow carries no comment-management code of its own. `actions/github-script` would mean hand-rolling the list/find/patch-or-create logic — pagination, the marker, the update path — for no gain. The action is a JavaScript action, so it needs no install step either.

   The job never fails a PR. The check's exit code is ignored, and the comment step is `continue-on-error`, so a drift report is a signal, never a gate. The degraded case is a report like any other: with the manifest absent (or corrupt, or from another `schemaVersion`) `--check` prints `degraded: true` and a `markdown` note naming the reason, and the job posts that note rather than staying silent.

   The workflow runs the skill **as committed** in the repo (`.agents/skills/code-quality-setup/scripts/plan.mjs`), never `npx skills add`: the report must describe the skill the repo actually carries.

   `permissions` is `contents: read` + `pull-requests: write` — the comment needs the write scope. On a PR from a fork the token is read-only whatever the block says, so the comment step fails there; `continue-on-error` keeps the job green and the report simply does not appear.

   The recipe's `verify` (frontmatter) parses the generated workflow with `node` — no YAML library, which the consumer's repo does not have — and asserts: the `pull_request` trigger; the two permission scopes; exactly one job; exactly four steps; the step markers in order (checkout, setup-node, `plan.mjs --check`, the sticky-comment action); and that the check step ignores the exit code.

## Idempotency

- `.github/workflows/code-quality-drift.yml` is a `create`: byte-identical on re-run, so it is a no-op. A local edit shows as drift and is reported, not overwritten.
- The comment is idempotent by construction: the action updates the one comment carrying the `header` marker, so a re-run replaces the report instead of appending a second one.

## Undo

- Delete `.github/workflows/code-quality-drift.yml`; delete `.github/workflows/` if it is empty.
- Delete the PR comment carrying the `code-quality-drift` marker, if one was posted.
