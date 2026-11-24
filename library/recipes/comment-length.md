---
id: comment-length
title: Comment length — a three-line cap on the comments a change adds
purpose: Fail a change that adds a comment longer than three lines, or a comment in an example, with a project-owned marker as the opt-in.
when:
  language: [typescript, javascript]
  requires: [{ file: .comment-length.json }]
cost: fast
priority: 15
files:
  - path: scripts/check-comments.mjs
    action: create
    scope: root
    template: templates/comment-length/scripts/check-comments.mjs
  - path: .husky/pre-commit
    action: merge
    scope: root
    template: templates/comment-length/pre-commit.block
  - path: .github/workflows/comment-length.yml
    action: create
    scope: root
    template: templates/comment-length/comment-length.yml
  - path: package.json
    action: merge
    scope: root
    template: templates/comment-length/package.json
commands: []
gates:
  - id: comment-length
    run: node scripts/check-comments.mjs --staged
    description: comments a change adds run three lines at most; examples carry none
verify:
  - gate: comment-length
    scope: root
  - run: node -e 'const fs=require("node:fs"),L=fs.readFileSync(".github/workflows/comment-length.yml","utf8").split("\n"),die=(m)=>{console.error(m);process.exit(1)};const jobs=(()=>{const i=L.findIndex((l)=>/^jobs:$/.test(l));if(i<0)die("no jobs");const o=[];for(let k=i+1;k<L.length;k++){const m=/^  (\S+):$/.exec(L[k]);if(m)o.push(m[1]);else if(/^\S/.test(L[k]))break;}return o;})();if(jobs.join()!=="comment-length")die("jobs: "+jobs.join());const job=(n)=>{const i=L.findIndex((l)=>l==="  "+n+":");if(i<0)die("no "+n+" job");let e=L.length;for(let k=i+1;k<L.length;k++){if(/^ {0,2}\S/.test(L[k])){e=k;break;}}return L.slice(i+1,e).filter((l)=>!/^\s*#/.test(l)).join("\n");};const b=job("comment-length");const steps=[...b.matchAll(/^\s*- name: (.+)$/gm)].map((m)=>m[1]);if(steps.join()!=="checkout,setup-node,Comment length")die("steps: "+steps.join());if(!/uses: actions\/checkout@v7/.test(b))die("no checkout pin");if(!/fetch-depth: 0/.test(b))die("no fetch-depth");if(!/uses: actions\/setup-node@v7/.test(b))die("no setup-node pin");if(!/node scripts\/check-comments\.mjs --base "\$\{\{ github\.event\.pull_request\.base\.sha \}\}"/.test(b))die("no base ref");'
    scope: root
---

## Apply

1. **`scripts/check-comments.mjs`** — create from
   `templates/comment-length/scripts/check-comments.mjs`. The gate, and the whole of the recipe's
   machinery: node builtins only, so it needs no install and serves Bun, npm and pnpm alike. It
   reads `.comment-length.json` for the cap (`maxLines`, default 3) and the recorded count
   (`warnings`, default 0), and it never writes that file — the marker is the project's opt-in, and
   a repo without it is not gated. Two rules: `comment-length` fails a comment longer than the cap
   that overlaps a line the change touches, and `example-comments` fails every comment under
   `examples/<a>/<b>/` (`examples/scripts/` and `examples/experiments/` are tooling, not examples).
   A run of `//` lines is one comment, `/* */` and `<!-- -->` blocks count, and a tool directive —
   `eslint-disable`, `@ts-expect-error`, `svelte-ignore`, `@__PURE__`, `prettier-ignore`,
   `check-code:` — is exempt, because the tool needs it and the reader does not read it. The
   script's own comments stay within the cap, so committing it does not fail its own gate.

   The rule is the `ui-sdk-unslop` skill's: "A comment longer than three lines. Cut it to the
   reason. An explanation that needs more goes in the docs page, a test title or `contributing/`."
   The cap is a proxy for that judgement, not a replacement: a three-line comment that narrates
   history still fails review, and the skill's other shapes — a comment that says what the next
   line does, a section banner, JSDoc that repeats the name — are the `comments` practice's
   subject, not this gate's.

2. **`.husky/pre-commit`** — merge the block from `templates/comment-length/pre-commit.block`. It
   runs the script's `--staged` mode, so the hook measures the diff the commit will carry. The
   marker comments are `#`, a valid `sh` comment: `<!--` here is a redirection and a syntax error
   at every commit. The block lands after the formatter's (priority 15 < 50), so it sees the
   content the formatter re-staged.

3. **`.github/workflows/comment-length.yml`** — create from
   `templates/comment-length/comment-length.yml`. Its **own** workflow file, never a block merged
   into `ci.yml`: attaching would need `requires: [{ recipe: ci-workflow }]` **or**
   `{ recipe: ci-workflow-npm }`, and the predicate language has no OR, so one edge would
   under-select the other package-manager variant. One job, `comment-length`, checking out with
   `fetch-depth: 0` and running the script with
   `--base "${{ github.event.pull_request.base.sha }}"`. The base is explicit because the gate is
   change-scoped: the PR's base SHA is the only ref that names the diff the PR adds, and a shallow
   clone does not contain it. The hook is a convenience and every hook is bypassable; the CI job is
   the half `--no-verify` cannot skip.

4. **`package.json`** — merge the fragment from `templates/comment-length/package.json`, which adds
   `lint:comments`. It is the by-hand entry point for the same `--staged` scope the hook runs; the
   gate itself is the `comment-length` gate, and the script's `--base <ref>` mode is what a human
   runs to reproduce a CI failure locally.

**The gate takes an explicit base.** `--staged` diffs the index, `--base <ref>` diffs that ref, and
with neither the script falls back to `merge-base HEAD origin/main` — the by-hand run on a branch.
The fallback is a convenience, not the contract: the hook passes `--staged` and CI passes the PR's
base SHA, so neither depends on a local `origin/main` being current.

**It starts at warn.** The marker's `warnings` is the recorded count: the gate prints every
violation and fails only when the count exceeds it. A repo adopting the recipe records the count it
has — `{ "maxLines": 3, "warnings": 12 }` — so the first commit is green and the next one that adds
a thirteenth comment fails. Fixing findings lowers the recorded count, and the project lowers
`maxLines` as the long comments go, until both are at the level it wants to hold. This is the
`@shadcn/lint` adoption shape: "Use the measured count in your lint script… It fails when the total
increases. Lower the cap as you fix findings."

**Scope.** This recipe stands alone as `comment-length`. It does not claim the `comments` practice
and does not enforce it: the practice is about *why* a comment earns its place, which no line count
can decide, and the practice's `enforcedBy` names the oxlint recipes. A repo that wants both
selects both; neither depends on the other.

The fixture `fixtures/comment-debt-ts` proves both scopes: its skeleton commit is the base, the
change commit adds a four-line comment and an example comment, and the marker records the two
findings. `--base <skeleton>` and `--staged` both report the two violations and exit 0 at the
recorded count; setting `warnings` to 0 makes either exit 1. The fixture's README records the
commands.

## Idempotency

- `scripts/check-comments.mjs` and `.github/workflows/comment-length.yml` are `create`s:
  byte-identical on re-run, so a re-run is a no-op. A local edit shows as drift and is reported, not
  overwritten.
- The `.husky/pre-commit` block is a marker merge: a re-run replaces the lines between
  `code-quality:comment-length:start` and `:end` and leaves the rest of the hook untouched. A hook
  that already runs the same command without the marker is reported as a duplicate and the block is
  not appended, so the gate does not run twice.
- The `package.json` merge adds `scripts.lint:comments`; a re-run finds the same value and writes
  nothing, and a differing value is a collision reported in the plan.
- `.comment-length.json` is never written by the recipe, so a re-run cannot reset the recorded count
  or the cap. The project owns both, and a repo that deletes the marker is simply ungated.

## Undo

- Delete `scripts/check-comments.mjs`; delete `scripts/` if it is empty.
- Delete the `code-quality:comment-length:start` … `:end` block from `.husky/pre-commit`; delete the
  file if it is empty.
- Delete `.github/workflows/comment-length.yml`; delete `.github/workflows/` if it is empty.
- Remove `scripts.lint:comments` from `package.json`.
- Delete `.comment-length.json` to opt out of the gate; the recipe never created it.
