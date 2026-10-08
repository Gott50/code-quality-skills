# Monorepo detection and per-package config placement for TypeScript workspaces

Research for `Gott50/code-quality-skill#4`. Question: how does `code-quality-setup` detect a
workspace, and where does each gate's configuration belong so one recipe lands correctly in a
single-package repo and in a workspace?

Method: primary sources only — package-manager docs, tool docs, tool repositories, and real
monorepos (Vitest, Vite, Turborepo, StrykerJS). Every non-obvious claim carries a link. Anything
not verified is marked **UNVERIFIED**.

---

## 1. How each workspace protocol is declared and detected

### 1.1 Declaration

| Manager | Declaration | Shape |
| --- | --- | --- |
| npm | `workspaces` in the **root** `package.json` | array of file globs, or object `{ "packages": [...] }` ([npm docs](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#workspaces); the object form is what `@npmcli/map-workspaces` reads — [README](https://github.com/npm/map-workspaces)) |
| Yarn (classic + Berry) | `workspaces` in the **root** `package.json` | array of glob patterns ([Yarn manifest](https://yarnpkg.com/configuration/manifest#workspaces), [Yarn workspaces](https://yarnpkg.com/features/workspaces)) |
| Bun | `workspaces` in the **root** `package.json` | array, or object `{ "packages": [...], "selfContained": [...] }`; full glob syntax incl. negation `!**/excluded/**` ([Bun workspaces](https://bun.sh/docs/pm/workspaces)) |
| pnpm | `pnpm-workspace.yaml` → `packages:` | list of globs; `!` excludes; `*` never matches a dot-dir; the root package is always included ([pnpm settings](https://pnpm.io/settings#packages)) |

Critical pnpm divergence: **pnpm reads the workspace from `pnpm-workspace.yaml`, not from the
`workspaces` field of the root `package.json`.** A root manifest with a non-empty `workspaces`
array and no `pnpm-workspace.yaml` gets a warning, because such an install links no project at all
([pnpm settings](https://pnpm.io/settings#packages)). Since pnpm v12.7.0, `pnpm install` will
*create* a `pnpm-workspace.yaml` from the `workspaces` field on first install, but an existing
`pnpm-workspace.yaml` is never changed and only it is read ([pnpm workspaces](https://pnpm.io/workspaces)).
A detector must therefore prefer `pnpm-workspace.yaml` when it exists and must not assume the
`workspaces` field is authoritative under pnpm.

### 1.2 Detection without invoking a package manager

The detector (`scripts/detect.mjs`, zero deps) can enumerate members from files alone:

1. **Package manager** from the lockfile: `bun.lock`/`bun.lockb` → Bun; `pnpm-lock.yaml` → pnpm;
   `package-lock.json` → npm; `yarn.lock` → Yarn. (Lockfile names are the conventional markers;
   `packageManager` in `package.json` is a corroborating signal — [Corepack](https://nodejs.org/api/corepack.html).)
2. **Workspace root**: the directory holding the root `package.json` (and, for pnpm, the
   `pnpm-workspace.yaml`).
3. **Member globs**:
   - pnpm: `packages:` from `pnpm-workspace.yaml`.
   - npm/Yarn/Bun: `workspaces` from the root `package.json` — accept both the array form and the
     object form (`workspaces.packages`), because `@npmcli/map-workspaces` accepts both
     ([README](https://github.com/npm/map-workspaces)) and Bun documents the object form
     ([Bun workspaces](https://bun.sh/docs/pm/workspaces)).
4. **Expand globs** with a small dependency-free matcher (`*` = one path segment, `**` = any depth,
   leading `!` = exclude). Each matched directory that contains a `package.json` is a member; read
   its `name` and `version`. pnpm's rules to mirror: root always included, `*` skips dot-dirs,
   `!` excludes ([pnpm settings](https://pnpm.io/settings#packages)).
5. **Report** `{ kind: "single" | "workspace", manager, root, members: [{ name, path }] }`.

No package manager is invoked; the detector only reads `package.json`, `pnpm-workspace.yaml`, and
the lockfile name. This matches the detector contract in `#7`.

---

## 2. Gate-by-gate placement

Legend: **root** = workspace root; **member** = each package; **both** = a root file plus a
per-member file that inherits from it.

| Gate | Config file | Location | Failure mode if placed wrongly |
| --- | --- | --- | --- |
| Formatter/linter (Biome) | `biome.json` / `biome.jsonc` | **both**: root config + per-package `{ "root": false, "extends": "//" }` | A nested config without `root: false`/`extends: "//"` becomes its own root and stops inheriting; running Biome from the repo root then fails unless `--config-path` points at one config ([Biome big projects](https://biomejs.dev/configuration/big-projects/)) |
| Linter (oxlint) | `.oxlintrc.json` / `oxlint.config.ts` | **both**: root base + per-package `extends` | Nested configs are **not** auto-merged — a child config replaces the parent for files under it; `options.typeAware`/`typeCheck` are root-config-only and error in a nested config ([oxlint nested config](https://oxc.rs/docs/guide/usage/linter/nested-config)) |
| `tsconfig` | `tsconfig.json` (+ a base) | **both**: root base (`tsconfig.base.json`/`tsconfig.settings.json`) + per-package `tsconfig.json` `extends`; or root `tsconfig.json` with project `references` | Per-package configs without `extends` duplicate settings; `paths`/`baseUrl` resolve relative to the config that declares them, so a root `paths` map is wrong for a member ([TSConfig extends](https://www.typescriptlang.org/tsconfig#extends)) |
| Test runner (Vitest) | `vitest.config.ts` | **root** with `test.projects: ['packages/*']`; per-package configs optional | The root config is **not** treated as a project unless listed; only global options (`reporters`, `coverage`) come from it ([Vitest projects](https://vitest.dev/guide/projects)) |
| Test runner (Bun) | `bunfig.toml` | **member** (per directory) | Bun has no "projects" concept; `bun test` recursively searches the cwd, so a root run sweeps every package and a per-package `bunfig.toml` is the only per-package knob ([Bun test](https://bun.sh/docs/test)) |
| Coverage | Vitest: root config; Bun: `bunfig.toml [test]` | **root** for an aggregate; **member** for per-package thresholds | Vitest coverage is a root-level option; Bun `coverageThreshold`/`coverageReporter` live in `bunfig.toml` ([Vitest projects](https://vitest.dev/guide/projects), [Bun coverage](https://bun.sh/docs/test/code-coverage)) |
| Mutation (Stryker) | `stryker.conf.json` / `.js` | **member**, each reading a shared root base | Stryker looks for its config in the cwd only and does **not** walk up ([stryker-js#2371](https://github.com/stryker-mutator/stryker-js/issues/2371)); `mutate` globs and `tsconfigFile` (default `tsconfig.json`) resolve from the cwd ([Stryker config](https://stryker-mutator.io/docs/stryker-js/configuration/)) |
| Git hooks (husky) | `.husky/` + `prepare` script | **root** only | Husky does not install in parent directories; a package-level `prepare` cannot reach the git root ([husky how-to](https://typicode.github.io/husky/how-to.html)) |
| Git hooks (lefthook) | `lefthook.yml` | **root** only, with per-command `root:` | Lefthook globs are always computed from the git root and it cannot pick the nearest config per staged file; per-package configs are redundant ([lefthook root](https://lefthook.dev/configuration/root/), [discussion #1193](https://github.com/evilmartians/lefthook/discussions/1193)) |
| CI | `.github/workflows/*.yml` | **root** only | Per-package workflows duplicate; a per-package matrix needs a detect-changes job feeding `fromJSON` ([GH Actions matrix](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)) |

### 2.1 Real-monorepo evidence

- **Vitest** (pnpm): root `tsconfig.base.json` extended by `packages/vitest/tsconfig.json`
  (`"extends": "../../tsconfig.base.json"`); root `tsconfig.check.json` for the whole-repo
  typecheck; root `.oxlintrc.jsonc`; root `package.json` scripts fan out with `pnpm -r`
  ([tsconfig.base.json](https://github.com/vitest-dev/vitest/blob/main/tsconfig.base.json),
  [packages/vitest/tsconfig.json](https://github.com/vitest-dev/vitest/blob/main/packages/vitest/tsconfig.json),
  [package.json](https://github.com/vitest-dev/vitest/blob/main/package.json)).
- **Vite** (pnpm): `pnpm-workspace.yaml` lists `packages/*`, `playground/**`, `docs`;
  `packages/vite/tsconfig.json` extends `./tsconfig.base.json`
  ([pnpm-workspace.yaml](https://github.com/vitejs/vite/blob/main/pnpm-workspace.yaml),
  [packages/vite/tsconfig.json](https://github.com/vitejs/vite/blob/main/packages/vite/tsconfig.json)).
- **StrykerJS** (pnpm): root `stryker.parent.conf.json` is the shared base; each package has a
  `stryker.conf.js` that reads the parent and adds package-specific fields; root `tsconfig.json`
  is a project-references file (`"files": []`, `"references": [...]`) over `tsconfig.settings.json`;
  root scripts run `lerna run test` / `lerna run stryker` across packages
  ([stryker.parent.conf.json](https://github.com/stryker-mutator/stryker-js/blob/master/stryker.parent.conf.json),
  [packages/core/stryker.conf.js](https://github.com/stryker-mutator/stryker-js/blob/master/packages/core/stryker.conf.js),
  [tsconfig.json](https://github.com/stryker-mutator/stryker-js/blob/master/tsconfig.json),
  [package.json](https://github.com/stryker-mutator/stryker-js/blob/master/package.json)).
- **Turborepo** (pnpm): root `turbo.json` declares per-task `dependsOn`/`outputs`; root-level
  tasks are namespaced `//#lint`, `//#format`; CI runs `turbo run ... --affected --filter="./packages/*"`
  ([turbo.json](https://github.com/vercel/turborepo/blob/main/turbo.json),
  [test-js-packages.yml](https://github.com/vercel/turborepo/blob/main/.github/workflows/test-js-packages.yml)).

---

## 3. How the tools actually behave in a workspace

### Biome
- Resolution: nearest `biome.json` from the cwd, then **walks upward** until it finds one
  ([Biome big projects](https://biomejs.dev/configuration/big-projects/)).
- v2 monorepo support: a root config plus nested configs with `"root": false` and
  `"extends": "//"` (the `//` microsyntax means "the root config, wherever it is"). A nested config
  that omits `extends: "//"` deliberately opts out of the root settings. You can run Biome from the
  root or from a package and it respects all settings.
- `extends` can point at a package (`"@org/shared-configs/biome"`), resolved from the **working
  directory** (CLI: where you run it; LSP: project root) — so a member that extends a root-only
  package needs that package resolvable from the member (see §4).
- `--config-path=PATH` disables default resolution and pins one config
  ([Biome CLI](https://biomejs.dev/reference/cli/)).

### oxlint
- Nearest-config resolution per file: `src/index.js` uses the root config, `package1/index.js` uses
  `package1/oxlint.config.ts` ([oxlint nested config](https://oxc.rs/docs/guide/usage/linter/nested-config)).
- Configs are **not** merged automatically; a child config replaces the parent for its subtree.
  The monorepo pattern is a root base plus per-package `extends` (JSON: array of paths; TS: imported
  config objects). Only `rules`, `plugins`, `overrides` are extendable.
- `options.typeAware`/`options.typeCheck` are root-config-only; setting them in a nested config is
  an error. `--config` disables nested lookup; `--disable-nested-config` turns it off.

### Vitest
- `test.projects` (formerly `workspace`, deprecated since 3.2) defines multiple project configs in
  one process; entries are inline configs, files, or globs (`'packages/*'`). A folder is a project
  even without a config file. Project names must be unique; glob projects default to the nearest
  `package.json` `name` ([Vitest projects](https://vitest.dev/guide/projects)).
- The root config is **not** a project unless listed; it only influences global options
  (`reporters`, `coverage`). Use `defineProject` in project configs; `reporters` is not supported
  there.
- `process.cwd()` in every project's tests is the directory where Vitest was started, not the
  project root ([Vitest common errors](https://vitest.dev/guide/common-errors#project-working-directory-does-not-change)).

### Bun test
- No projects/workspace concept. `bun test` recursively searches the **working directory** for
  `*.test.*`/`*.spec.*`; filters are file/dir names, not package names
  ([Bun test](https://bun.sh/docs/test)). In a Bun workspace you either run `bun test` at the root
  (sweeps all packages) or per package via `bun run --filter '*' test` / `bun --filter <pkg> test`
  ([Bun workspaces](https://bun.sh/docs/pm/workspaces)).
- `bunfig.toml` is per-directory, so per-package test/coverage settings live in each package.

### Stryker
- Config is read from the cwd; there is no parent-directory search (feature request
  [stryker-js#2371](https://github.com/stryker-mutator/stryker-js/issues/2371) was closed stale).
  The monorepo pattern is a per-package config that imports a shared root base — exactly what
  StrykerJS does itself.
- `tsconfigFile` defaults to `tsconfig.json` and is used to rewrite `extends`/`references` inside
  the sandbox ([Stryker configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)).
- Stryker copies the project into a sandbox (`.stryker-tmp/sandbox-*`) that has **no
  `node_modules`**; the troubleshooting docs tell you to invoke compilers by full path from the
  sandbox ([Stryker troubleshooting](https://stryker-mutator.io/docs/stryker-js/troubleshooting/)).
  `--inPlace` avoids the sandbox. This is why a single root config mutating several packages is
  fragile: relative paths and workspace symlinks do not survive the copy.

### husky
- Uses Git's `core.hooksPath`; installs at the git root via a root `prepare` script. It does not
  install in parent directories, so a package-level `prepare` cannot reach the git root
  ([husky how-to](https://typicode.github.io/husky/how-to.html)).
- In CI/Docker set `HUSKY=0` to skip installation ([husky how-to](https://typicode.github.io/husky/how-to.html)).

### lefthook
- One root `lefthook.yml`; `lefthook install` writes hooks into `.git/hooks/`
  ([lefthook](https://lefthook.dev/)). Per-command `root:` changes the CWD for that command, but
  **globs are always computed from the git root** ([lefthook root](https://lefthook.dev/configuration/root/)).
- Lefthook cannot select the nearest config per staged file; the workaround is redundant per-package
  configs ([discussion #1193](https://github.com/evilmartians/lefthook/discussions/1193)).

### GitHub Actions
- A matrix creates one job per variable combination; `include`/`exclude` refine it; `fromJSON`
  builds a matrix from a prior job's output ([GH Actions matrix](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)).
- Real patterns: Vitest runs a **single root lint job** (`pnpm run lint` = oxlint + oxfmt) and a
  matrix over **test suites** (`unit`/`e2e`/`coverage`) × OS × Node
  ([ci.yml](https://github.com/vitest-dev/vitest/blob/main/.github/workflows/ci.yml)). Turborepo
  runs one job per OS × Node and fans out with `turbo run ... --affected --filter="./packages/*"`
  ([test-js-packages.yml](https://github.com/vercel/turborepo/blob/main/.github/workflows/test-js-packages.yml)).
  A per-package matrix is possible via a detect-changes job emitting
  `pnpm --filter '...[origin/main]' list --json` and `fromJSON` ([pnpm CI best practices](https://github.com/jetbrains/skills/blob/HEAD/pnpm/references/best-practices-ci.md)).

---

## 4. What breaks when a tool is configured at the root under pnpm's strict, non-hoisted `node_modules`

pnpm's default `nodeLinker` is `isolated`: every package's `node_modules` contains only the
dependencies it declares, symlinked from `node_modules/.pnpm` ([pnpm symlinked structure](https://pnpm.io/symlinked-node-modules-structure)).
Consequences:

1. **Binaries are fine.** `pnpm run` and `pnpm exec` add `<workspace root>/node_modules/.bin` to
   `PATH` for every workspace package's scripts, so a root-installed CLI is callable from a member
   ([pnpm run](https://pnpm.io/cli/run)). A package's own `node_modules/.bin` outranks the root's
   ([pnpm#12891](https://github.com/pnpm/pnpm/pull/12891)). So "the tool binary isn't found" is
   **not** the failure mode.
2. **Package resolution by name is the failure mode.** A tool that resolves a *package* (not a
   binary) from a member's cwd cannot see the root's `node_modules`. pnpm's own docs give the
   canonical case: ESLint loading a plugin developed in the same monorepo, fixed with
   `publicHoistPattern: ["*eslint*"]` ([pnpm settings](https://pnpm.io/settings#dependency-hoisting-settings)).
   The same applies to a Biome `extends` package, a Stryker plugin, or a `tsconfig` `extends`
   package referenced from a member.
3. **Hidden hoisting is not enough for modules outside `node_modules`.** `hoist` defaults to `true`
   and hoists everything to `node_modules/.pnpm/node_modules`, which makes undeclared deps
   accessible to packages *inside* `node_modules` but not to modules outside it; `publicHoistPattern`
   defaults to `[]`, so the root `node_modules` holds only declared root deps
   ([pnpm settings](https://pnpm.io/settings#dependency-hoisting-settings)).
4. **Tools that walk `node_modules` physically break.** Electron packagers and serverless bundlers
   expect one workspace's `node_modules` to be a complete tree; Bun addresses this with
   `installConfig.hoistingLimits: "workspaces"` / `workspaces.selfContained`, and pnpm with
   `hoistingLimits: workspaces` ([Bun workspaces](https://bun.sh/docs/pm/workspaces),
   [pnpm settings](https://pnpm.io/settings#dependency-hoisting-settings)).
5. **Symlink realpath.** Node ignores symlinks during resolution, but tools that call `realpath`
   (or run with `--preserve-symlinks`) can resolve a dependency to its store location, outside the
   project ([pnpm symlinked structure](https://pnpm.io/symlinked-node-modules-structure)).

Practical rule for the skill: a root-level config that a member must *read* (Biome `extends`,
oxlint `extends`, `tsconfig` `extends`, Stryker plugin) is safe only if the referenced package is
declared in the member or publicly hoisted. A root-level config that a member only *runs* (a CLI
binary) is safe because of the root `.bin` on `PATH`.

---

## 5. Decision: the minimal placement declaration a recipe must express

The recipe contract (`#6`) must let one recipe land correctly in both repo shapes. The detector
reports the shape; the recipe declares placement in terms of **roles**, and the skill maps roles to
paths.

### 5.1 Detector output the recipe reads

```jsonc
{
  "workspace": {
    "kind": "single" | "workspace",
    "manager": "bun" | "pnpm" | "npm" | "yarn",
    "root": ".",
    "members": [{ "name": "@org/a", "path": "packages/a" }]
  }
}
```

### 5.2 Recipe fields

```jsonc
{
  "when": {
    "workspace": "any" | "single" | "workspace"   // default "any"
    // existing: language, packageManager, requiredFiles, requiredDependencies, exclusions
  },
  "files": [
    {
      "path": "biome.json",
      "scope": "root" | "member" | "both",       // required
      "memberMode": "extends-root" | "standalone" | "copy",  // default "standalone"; only when scope includes member
      "merge": "create" | "merge" | "patch"      // existing field
    }
  ],
  "commands": [
    { "run": "biome check .", "scope": "root" | "member" | "each-member" }
  ],
  "verify": [
    { "run": "biome check .", "scope": "root" | "member" | "each-member" }
  ]
}
```

### 5.3 Mapping rules (the whole contract)

- **`when.workspace`** gates applicability: `single` = only single-package repos, `workspace` =
  only workspaces, `any` = both. A recipe that only makes sense with members (e.g. a per-package
  matrix) declares `workspace`.
- **`scope: "root"`** → the workspace root; in a single-package repo, the package root.
- **`scope: "member"`** → each member; in a single-package repo, the package root (the one package
  is both root and member).
- **`scope: "both"`** → a root file plus a per-member file; in a single-package repo, **one** file
  at the package root (no duplication).
- **`memberMode`** decides how the member file relates to the root file:
  - `extends-root` — member file inherits the root file (Biome `extends: "//"`, oxlint `extends`,
    `tsconfig` `extends`, Stryker `import` of the parent config).
  - `standalone` — member file is self-contained (Bun `bunfig.toml`).
  - `copy` — member file is a copy of the root file (no inheritance mechanism exists).
- **`commands[].scope` / `verify[].scope`**:
  - `root` — run once at the workspace root.
  - `member` — run once, in the single package (single-package) or at the root (workspace) — i.e.
    "the project", not per member.
  - `each-member` — run once per member with cwd = member path; in a single-package repo, run once
    at the package root.

### 5.4 Worked examples

| Recipe | `when.workspace` | `files[].scope` | `memberMode` | `commands[].scope` |
| --- | --- | --- | --- | --- |
| Biome format+assist | `any` | `both` | `extends-root` | `root` |
| oxlint | `any` | `both` | `extends-root` | `root` |
| tsconfig strict | `any` | `both` | `extends-root` | `root` |
| Vitest projects | `any` | `root` | — | `root` |
| Bun test + coverage | `any` | `member` | `standalone` | `each-member` |
| Stryker | `any` | `member` | `extends-root` | `each-member` |
| husky | `any` | `root` | — | `root` |
| lefthook | `any` | `root` | — | `root` |
| CI workflow | `any` | `root` | — | `root` |

This is the minimal set: `when.workspace` (one enum), `files[].scope` (one enum) plus
`files[].memberMode` (one enum), and `commands[].scope`/`verify[].scope` (one enum). Everything
else the contract already has (`id`, `title`, `when` signals, `conflicts`, `merge`, `cost`,
`idempotency`, `undo`) is unchanged.

---

## 6. Open / unverified

- **UNVERIFIED**: whether npm's CLI accepts the object form `{ "packages": [...] }` in practice.
  The npm docs document only the array form; `@npmcli/map-workspaces` accepts both. The detector
  should accept both defensively.
- **UNVERIFIED**: exact pnpm version that first added `<workspace root>/node_modules/.bin` to
  script `PATH`. The behavior is documented in current pnpm docs and in
  [pnpm#12891](https://github.com/pnpm/pnpm/pull/12891); the version boundary was not pinned.
- **UNVERIFIED**: whether Biome's `extends: "//"` resolves correctly when the root config is
  reached through a pnpm symlink; the docs describe the microsyntax but not the symlink case.
