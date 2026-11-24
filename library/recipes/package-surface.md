---
id: package-surface
title: Package surface — pack each package and typecheck it as a strict consumer
purpose: Fail a published package whose declarations break in a consumer, by packing it, installing the tarball in a scratch app, and typechecking every public entry.
when:
  requires: [{ packageExports: true }, { dep: typescript }]
cost: heavy
priority: 15
files:
  - path: scripts/check-packages.mjs
    action: create
    scope: root
    template: templates/package-surface/scripts/check-packages.mjs
  - path: .github/workflows/package-surface.yml
    action: create
    scope: root
    template: templates/package-surface/package-surface.yml
  - path: package.json
    action: merge
    scope: root
    template: templates/package-surface/package.json
commands: []
gates:
  - id: package-surface
    run: node scripts/check-packages.mjs --build
    description: pack each package, install the tarballs in a scratch app, typecheck every public entry with strict, exactOptionalPropertyTypes and skipLibCheck false
verify:
  - gate: package-surface
    scope: root
  - run: node -e 'const fs=require("node:fs"),L=fs.readFileSync(".github/workflows/package-surface.yml","utf8").split("\n"),die=(m)=>{console.error(m);process.exit(1)};const jobs=(()=>{const i=L.findIndex((l)=>/^jobs:$/.test(l));if(i<0)die("no jobs");const o=[];for(let k=i+1;k<L.length;k++){const m=/^  (\S+):$/.exec(L[k]);if(m)o.push(m[1]);else if(/^\S/.test(L[k]))break;}return o;})();if(jobs.join()!=="package-surface")die("jobs: "+jobs.join());const job=(n)=>{const i=L.findIndex((l)=>l==="  "+n+":");if(i<0)die("no "+n+" job");let e=L.length;for(let k=i+1;k<L.length;k++){if(/^ {0,2}\S/.test(L[k])){e=k;break;}}return L.slice(i+1,e).filter((l)=>!/^\s*#/.test(l)).join("\n");};const b=job("package-surface");const steps=[...b.matchAll(/^\s*- name: (.+)$/gm)].map((m)=>m[1]);if(steps.join()!=="checkout,setup-node,install,build,Package surface")die("steps: "+steps.join());if(!/uses: actions\/checkout@v7/.test(b))die("no checkout pin");if(!/uses: actions\/setup-node@v7/.test(b))die("no setup-node pin");if(!/node scripts\/check-packages\.mjs/.test(b))die("no gate command");'
    scope: root
---

## Apply

1. **`scripts/check-packages.mjs`** — create from
   `templates/package-surface/scripts/check-packages.mjs`. The gate is the ui-sdk
   `check-packages.mjs` ported to node builtins: `tsc` over the sources reads what the build
   reads, while this reads the declarations the build emits, which can break while the sources
   pass — a type that names a module its file cannot reach, or an entry whose `types` file the
   tarball does not carry.

   It discovers the workspace packages from `pnpm-workspace.yaml` when the repo uses pnpm, else
   from the root `package.json` `workspaces` globs, and keeps the ones whose manifest declares
   `exports`; the root manifest is a candidate too, so a single-package repo is packed. Each is
   packed as it is published — `bun pm pack`, `pnpm pack` or `npm pack`, chosen by the lockfile the
   repo carries — and every tarball is unpacked into a scratch app's `node_modules` before any is
   checked, so a package that needs another takes it as a peer and the app ends up with one copy.
   The tarball's own manifest is what the consumer imports, so a `publishConfig` override is what
   gets checked. For each package a generated file imports every subpath of the packed `exports`
   except `./package.json` and patterns, and TypeScript runs with `strict`,
   `exactOptionalPropertyTypes` and `skipLibCheck: false`, so an error in a shipped declaration
   fails here as it does in the strictest app that checks its libraries.

   Two checks run before the typecheck. Every relative import in a packed module must name a file,
   because Node's loader takes neither a folder nor a path without its extension. An entry whose
   `types` file is not in the tarball is reported as a missing declaration — a build that stopped
   and a wrong `publishConfig.exports` path look the same from here. Each error is reported once,
   under the first package that reaches it.

   The recipe does not install application dependencies. It installs the packed tarballs into a
   scratch app, which is gate tooling: the app exists to resolve the declarations, not to run the
   project.

   `--build` runs each package's own `build` script before packing, so the recipe's `verify` is
   self-sufficient on a fresh checkout with no `dist`; the CI workflow builds in its own step and
   runs the gate without the flag.

2. **`.github/workflows/package-surface.yml`** — create from
   `templates/package-surface/package-surface.yml`. Its own workflow, never a block merged into
   `ci.yml`: the gate needs the packages built first, and the recipe has no package-manager
   predicate, so the install step reads the lockfile the repo carries. One job, `package-surface`,
   with `checkout`, `setup-node`, `install`, `build` and the `Package surface` step that runs the
   gate.

3. **`package.json`** — merge from `templates/package-surface/package.json`: the `check:packages`
   script, so the gate is runnable by hand.

The gate is `heavy`: it packs and typechecks every package, so it is slower than a source
typecheck and belongs in CI rather than a pre-commit hook.

The fixture `fixtures/published-ts` is the proof: its `@fixture/lib` declaration names
`../src/internal.js`, which the tarball cannot reach, so the gate exits 1; `@fixture/clean` is the
positive case and exits 0. The fixture's README records the exact commands.

## Idempotency

- `scripts/check-packages.mjs` and `.github/workflows/package-surface.yml` are `create`s:
  byte-identical on re-run, so they are no-ops. A local edit shows as drift and is reported, not
  overwritten.
- The `package.json` merge adds the `check:packages` script; a repo that already carries it with
  the same value is a duplicate and is not appended twice.
- The scratch app is a fresh `mkdtemp` directory per run and is removed on exit, so a re-run never
  reads a previous run's tarballs or declarations.

## Undo

- Delete `scripts/check-packages.mjs`; delete `scripts/` if it is empty.
- Delete `.github/workflows/package-surface.yml`; delete `.github/workflows/` if it is empty.
- Remove the `check:packages` script from `package.json` (the merged key).
