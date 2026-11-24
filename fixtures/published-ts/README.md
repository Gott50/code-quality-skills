# published-ts

A two-package workspace that publishes TypeScript declarations, one of which breaks in a consumer.
It is the proof for the `package-surface` recipe's `verify`: pack each package as it is published,
install the tarballs in a scratch app, and typecheck every public entry as a strict consumer would.

The root manifest declares `workspaces` and no `exports`; both packages declare `exports` pointing
at `dist`. That is the shape the `{ packageExports: true }` predicate selects on: any detected
manifest that declares `exports`, presence-only.

## The two cases

`@fixture/lib` is broken. `src/index.ts` re-exports a type from `src/internal.ts` through an import
expression, and the emitted `dist/index.d.ts` keeps that specifier:

```ts
export type Broken = import("../src/internal.js").Secret;
```

From `dist/index.d.ts` the specifier resolves to `packages/lib/src/internal.js`, which the tarball
does not contain: `files` is `["dist"]`. The sources typecheck, so `tsc` is green; only a consumer
reading the packed declaration fails, with `Cannot find module '../src/internal.js'`. The `.js`
extension is what `moduleResolution: NodeNext` requires in the source; it does not change the
failure, because the file it names is still outside the tarball.

`@fixture/clean` is the positive case. Its `src/index.ts` exports a value whose declaration is
self-contained, so `dist/index.d.ts` typechecks in a consumer.

## Commands

```
cd fixtures/published-ts
npm install
npm run build --workspaces
```

Both builds exit 0 and write `packages/lib/dist` and `packages/clean/dist`. The fixture is not
installed in this repo and carries no `node_modules`; `npm install` is the first step of the proof.

With the `package-surface` recipe applied at the repo root, the gate packs both packages and
typechecks their entries:

```
node scripts/check-packages.mjs
```

Expected result: exit 1. The report names `@fixture/lib` and the missing module
`../src/internal.js`; `@fixture/clean` passes. Run against `@fixture/clean` alone, the same gate
exits 0 — that is the control that shows the failure comes from the declaration and not from the
harness.
