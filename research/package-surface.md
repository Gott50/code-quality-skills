---
topic: package-surface
question: >-
  What does a published TypeScript library's surface need that a source typecheck misses?
verdict: >-
  A source typecheck reads the sources; a packed-package check reads the declarations the build
  emits, with `strict`, `exactOptionalPropertyTypes` and `skipLibCheck: false`, and catches a
  declaration that names a module the packed entry cannot reach. The sources can pass while the
  published surface is broken, because the two read different files: `pnpm typecheck` resolves the
  workspace, where a deep import into a sibling package's internals works, and where a declaration
  file is skipped by `skipLibCheck`. A consumer resolves the tarball, where only the `exports` map
  exists, every relative import must name a real file, and every shipped `.d.ts` is checked. The
  gate is therefore a recipe that packs each package, installs the tarballs in a scratch app, and
  typechecks every public entry as the strictest consumer would.
sources:
  - https://github.com/vercel-labs/ui/blob/main/scripts/check-packages.mjs
  - https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html
  - https://www.typescriptlang.org/tsconfig/skipLibCheck.html
  - https://docs.npmjs.com/cli/v11/configuring-npm/package-json
---

# Package surface: what a source typecheck cannot see

## 1. The source typecheck and the consumer read different files

`check-packages.mjs` states the gap in its own header: "`pnpm typecheck` reads the sources; this
reads the declarations the build emits, which can break while the sources pass, like a type that
names something its file can't reach"
([check-packages.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-packages.mjs)).

That is not a hypothetical. A workspace typecheck resolves through the workspace: a package's
`tsconfig` maps `@scope/core` to `packages/core/src`, so an import of `@scope/core/internal/parse`
typechecks even though `core` publishes no such subpath. The declaration the build emits keeps the
same specifier, and the consumer has only the `exports` map to resolve it against. The sources are
green; the published package is unusable.

The second half of the gap is `skipLibCheck`. It defaults to `false`, so declaration files are
checked unless a project opts out; when enabled it is documented as "Skip type checking of
declaration files", and the docs are explicit about what that buys and costs: "This can
save time during compilation at the expense of type-system accuracy … Rather than doing a full check
of all d.ts files, TypeScript will type check the code you specifically refer to in your app's
source code"
([TypeScript: skipLibCheck](https://www.typescriptlang.org/tsconfig/skipLibCheck.html)). A library
that ships a broken `.d.ts` and checks itself with `skipLibCheck: true` never reads the file it
publishes. The consumer that sets `skipLibCheck: false` does.

## 2. `pnpm pack` is the only honest input

The check does not read `dist/` or the workspace tree. It runs `pnpm pack` on each package, "packs
each package as it's published, with `publishConfig`'s exports pointing at `dist`, and every tarball
is unpacked into the app's `node_modules` before any is checked"
([check-packages.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-packages.mjs)).

Packing is what makes the check honest, for three reasons:

- **`files` and `.npmignore` decide the tarball, not the build.** A `dist` directory that exists on
  disk but is excluded from the tarball is invisible to a check that reads the working tree.
- **`publishConfig` rewrites the manifest.** The `exports` a consumer resolves is the one
  `publishConfig` produces, not the one in the source `package.json`. A check that reads the source
  manifest validates a map nobody installs.
- **The tarball is the unit the registry serves.** Anything the pack step drops — a `.d.ts`, a
  `package.json` subpath, a `dist` chunk — is missing for every consumer, and only the tarball shows
  it.

`exports` is the whole surface, by design: it "provides a modern alternative to `main` allowing
multiple entry points to be defined, conditional entry resolution support between environments, and
preventing any other entry points besides those defined in `exports`. This encapsulation allows
module authors to clearly define the public interface for their package"
([npm: package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)). A subpath the
map does not name is not public, whatever the file layout says.

## 3. The generated entry file: every subpath of the packed `exports`

"For each package, a generated file imports every subpath of its packed `exports`, except
`./package.json` and patterns"
([check-packages.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-packages.mjs)).

Generating the file from the packed map, rather than from a hand-written list, is what keeps the
check from drifting: a new subpath is covered the moment it is published, and a subpath that was
removed fails the check instead of lingering in a stale import list. `./package.json` is excluded
because it is a data file, not a module; patterns (`./*`) are excluded because they name a family,
not an entry, and the concrete files they resolve to are not enumerable from the map alone.

The generated file is the consumer's view in miniature: one import per public entry, resolved
through `exports`, with no workspace path mapping to fall back on.

## 4. The compiler flags that make a shipped declaration fail

"TypeScript runs with `strict`, `exactOptionalPropertyTypes` and `skipLibCheck: false`, so an error
in a shipped declaration fails here as it does in the strictest app that checks its libraries"
([check-packages.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-packages.mjs)).

Each flag closes a different hole:

- **`strict`** is the floor a consumer is entitled to assume. A declaration that only typechecks
  under a looser config is a declaration that fails in the app.
- **`exactOptionalPropertyTypes`** is the one that catches a real publishing bug. "With
  exactOptionalPropertyTypes enabled, TypeScript applies stricter rules around how it handles
  properties on type or interfaces which have a `?` prefix": without it, `colorThemeOverride?:
  "dark" | "light"` also accepts `undefined`; with it, assigning `undefined` is an error —
  "Type 'undefined' is not assignable to type '"dark" | "light"' with
  'exactOptionalPropertyTypes: true'"
  ([TypeScript: exactOptionalPropertyTypes](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)).
  A library that builds its declarations under a config without this flag can emit a `.d.ts` whose
  optional properties are wider than the runtime accepts, and only a consumer with the flag on sees
  it.
- **`skipLibCheck: false`** is what makes the shipped `.d.ts` the thing being checked rather than
  the thing being trusted (§1).

The three together are the strictest consumer's config, which is the only config a library can
safely assume. A library that passes a looser check has proven something about its own build, not
about its surface.

## 5. Every relative import in a packed module must name a file

"Node then imports every core, React and Vue entry, as an app's server would. Every relative import
in a packed module must name a file, since Node's loader takes neither a folder nor a path without
its extension"
([check-packages.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-packages.mjs)).

This is the failure a bundler-first build hides. A bundler resolves `./utils` to `./utils.js` and
`./icons` to `./icons/index.js`; Node's ESM loader does neither. A declaration or module that emits
`export * from "./utils"` works in the workspace, works in the bundler's output, and throws
`ERR_MODULE_NOT_FOUND` in the consumer's server. The check runs Node over the packed entries
precisely because the typechecker will not catch it: TypeScript resolves the extensionless
specifier happily, and the failure is at runtime.

The rule is mechanical and cheap to state: in a packed module, every relative specifier carries its
extension and names a file, never a directory.

## 6. An entry whose `types` file is not in the tarball is a missing declaration

"An entry whose `types` file isn't in the tarball is listed with that path: a build that stopped or
a wrong `publishConfig.exports` path, which look the same from here"
([check-packages.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-packages.mjs)).

The two causes are indistinguishable from the consumer's side, and that is the point: a build that
stopped before emitting `dist/index.d.ts` and an `exports` map that points `types` at
`dist/types/index.d.ts` while the build writes `dist/index.d.ts` produce the same broken package.
The check reports the path it could not find, which is the one fact that separates the two for the
maintainer.

This is also why the check must read the packed `exports` rather than the source one (§2): the
`types` condition a consumer resolves is the one `publishConfig` produced.

## 7. A package that needs another package takes it as a peer

"Every package is unpacked side by side, as an app installs an adapter with `@ui-sdk/core` beside
it. A package that needs another `@ui-sdk` package takes it as a peer, never a dependency, so an
app ends up with one copy"
([check-packages.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-packages.mjs)).

Unpacking side by side is what makes the peer rule testable. If an adapter declares `@ui-sdk/core`
as a dependency, the app can end up with two copies — the adapter's and the app's — and the types
from one are not the types from the other. A `peerDependencies` entry plus the app's own install
gives one copy, and the check's layout reproduces that: every tarball in one `node_modules`, no
nested resolution.

The rule generalises past a single scope: a package that needs a sibling package in the same
release train takes it as a peer, because the app is the one that decides which version of the
sibling is installed.

## 8. The gate is a recipe

The check is a recipe, not a practice, because every step above is mechanical and fails on a
specific file:

1. `pnpm pack` each package in the workspace.
2. Unpack every tarball into a scratch app's `node_modules`, side by side.
3. Generate one file per package that imports every subpath of its packed `exports`, except
   `./package.json` and patterns.
4. Typecheck that app with `strict`, `exactOptionalPropertyTypes` and `skipLibCheck: false`.
5. Run Node over the packed entries, so every relative import must name a file.
6. Report an entry whose `types` file is absent from the tarball, with the path.

The recipe's `verify` is the gate itself: a clean pack of the workspace's packages typechecks and
imports. A correctly built package can pass cold, so the first run is where the surface is first
*evidenced* rather than where it necessarily fails — an unexercised surface carries no guarantee
either way, and the gap it closes is real and pre-existing, not introduced by the recipe.

The judgement half — which subpaths to publish at all, whether a package should be split, whether a
sibling belongs in the same release train — is not gateable and does not belong in this note.

## 9. What this note does not decide

The `published-ts` fixture, the `{ packageExports: true }` predicate and the `schemaVersion` bump
are a separate ticket (#242). This note records the question, the verdict and the sources; it does
not start a schema change, and it adds no recipe, fixture or predicate. The predicate set is part of
the library contract, and adding `{ packageExports: true }` moves the version gate the update check
reads — that is #242's change, not this note's.

## Routing

| Practice | Gate? | Where |
| --- | --- | --- |
| **`package-surface` recipe** — pack each package, install the tarballs in a scratch app, typecheck every public entry with `strict`, `exactOptionalPropertyTypes` and `skipLibCheck: false`, and run Node over the packed entries | Yes — `package-surface`, separate ticket #242 | `library/recipes/package-surface.md` (to be written in #242) |
| **`published-ts` fixture** — a workspace with a build step, a `publishConfig`/`exports` map, a broken-declaration negative case and a clean-declaration positive case | separate ticket #242 | `fixtures/published-ts/` (to be written in #242) |
| **`{ packageExports: true }` predicate** — presence-only, true when the root manifest declares `exports`; bumps `library.json`'s `schemaVersion` | separate ticket #242 | `library/RECIPE-CONTRACT.md` and the `schemaVersion` bump (to be written in #242) |
