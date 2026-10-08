# Non-Bun TypeScript equivalents for every planned gate

Ticket: [Gott50/code-quality-skill#5](https://github.com/Gott50/code-quality-skill/issues/5) · Branch `research/non-bun-gate-equivalents` · 2026-10-08

The recipe library is proven on Bun (`bun test`, `bunfig.toml`, `@hughescr/stryker-bun-runner`, `oxlint` + `@oxlint/plugins`, `biome.json` assist, husky via `prepare`, `.bun-version`). This note establishes, gate by gate, the npm/pnpm equivalent with a primary-source citation, the package + version, the config file, the command, and the failure-mode class that mirrors the Bun gotchas recorded in `skill://port-omp-factory-quality-harness`, `skill://pre-push-mutation-gate`, `skill://stryker-gate-timeout-enforcement`.

Version numbers below are the `latest` dist-tags read from the npm registry on 2026-10-08 (`https://registry.npmjs.org/<pkg>/latest`). The Bun baseline is the omp-factory tree (`/Users/timomorawitz/Documents/omp-factory`), per the three local skills.

## Summary

| Gate | Bun baseline | npm/pnpm equivalent | Key version | Config file | Command |
|---|---|---|---|---|---|
| Format + assist | `@biomejs/biome` assist actions, linter disabled | **identical** — Biome is runtime-agnostic | `@biomejs/biome` 2.5.15 | `biome.json` | `npx biome check` / `pnpm exec biome check` |
| Lint + anti-slop | `oxlint` + `@oxlint/plugins` JS plugin | **identical** — oxlint ≥1.17 is Node-based | `oxlint` 1.87.0, `@oxlint/plugins` 1.87.0 | `oxlint.config.ts` | `npx oxlint` |
| Test + coverage | `bun test --coverage` + `bunfig.toml` | Vitest (`@vitest/coverage-v8` or `-istanbul`) or Jest (`coverageProvider`) | vitest 5.0.3 / jest 30.5.2 | `vitest.config.ts` / `jest.config.*` | `vitest run --coverage` / `jest --coverage` |
| Coverage → Istanbul bridge | `scripts/lcov-to-istanbul.ts` (Bun emits lcov only) | **not needed** — Vitest & Jest both emit `coverage/coverage-final.json` | — | coverage `json` reporter | — |
| Mutation | `@stryker-mutator/core` + `@hughescr/stryker-bun-runner` | `@stryker-mutator/vitest-runner` or `-jest-runner` | `@stryker-mutator/core` 10.0.0, runners 10.0.0 | `stryker.conf.mjs` | `npx stryker run` |
| Hooks | husky via `"prepare": "husky"` | **identical** for npm; pnpm runs project lifecycle scripts too | husky 9.1.7 | `package.json` + `.husky/` | `npm install` / `pnpm install` |
| Version pinning | `.bun-version` (setup-bun `bun-version-file`) | `.node-version` / `.nvmrc` (setup-node `node-version-file`) | — | `.node-version` | `actions/setup-node@v7` |

Two facts cut across every gate:

- **Stryker already runs on Node.** The bun-runner README states "Stryker itself runs on Node (only the test children run on Bun)"; `@stryker-mutator/core` 10.0.0 declares `engines.node >= 22.0.0`. So a Bun project's mutation gate already requires a Node host; the non-Bun move changes the *test runner plugin*, not the host. ([stryker-bun-runner README](https://github.com/hughescr/stryker-bun-runner); [registry](https://registry.npmjs.org/@stryker-mutator/core/latest))
- **oxlint is now Node-based, not Bun-based.** Since oxlint v1.17.0 the GitHub release archives ship only a Node.js native addon, because JS-plugin support needs a JS runtime; an oxc collaborator confirms "Newer versions of Oxlint require node.js. There isn't a native executable alternative anymore. This is a result of Oxlint adding support for JavaScript plugins." Bun runs it only through its Node compatibility. ([oxc discussion #14452](https://github.com/oxc-project/oxc/discussions/14452))

---

## 1. Test runner and coverage

### Bun baseline

`package.json`: `"test": "bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage && bun scripts/coverage-gate.ts --lcov coverage/lcov.info --threshold 100"`. Coverage behaviour is carried by `bunfig.toml` (`[test] coverage = true`, `coveragePathIgnorePatterns = ["**/tmp/**", "**/*-bin.ts"]`). The 100%-per-file-lines-and-functions gate is a hand-written script (`scripts/coverage-gate.ts`) because Bun's own `coverageThreshold` is global, not per-file. The `**/*-bin.ts` exclusion exists because "subprocess entrypoints … bun cannot coverage-instrument" (`skill://port-omp-factory-quality-harness`).

### npm/pnpm equivalent — Vitest (recommended) or Jest

**Vitest.** Provider is selected with `test.coverage.provider` (`'v8'` default, or `'istanbul'`); install `@vitest/coverage-v8` or `@vitest/coverage-istanbul` (both 5.0.3, peer `vitest@5.0.3`). Vitest's built-in per-file thresholds replace the custom gate: `coverage.thresholds.perFile` accepts `true` or an object, and `{ 100: true }` is "a shortcut for setting all four metrics to `100`" — i.e. per-file 100% lines/functions/branches/statements, exactly the Bun gate's intent. Config file: `vitest.config.ts`. Command: `vitest run --coverage` (or `--coverage.enabled` with dot-notation options). ([Vitest coverage guide](https://vitest.dev/guide/coverage); [Vitest coverage config](https://vitest.dev/config/coverage))

**Jest.** `coverageProvider` is `babel` (default, Istanbul instrumentation) or `v8`; thresholds are `coverageThreshold.global` plus per-glob-pattern thresholds. Config file: `jest.config.{js,ts,mjs,cjs,json}` (or the `"jest"` key in `package.json`). Command: `jest --coverage`. ([Jest configuration](https://jestjs.io/docs/configuration))

`vitest` 5.0.3 requires `node ^22.12.0 || ^24.0.0 || >=26.0.0`; `jest` 30.5.2 requires `node ^18.14.0 || ^20.0.0 || ^22.0.0 || >=24.0.0`. ([registry](https://registry.npmjs.org/vitest/latest), [registry](https://registry.npmjs.org/jest/latest))

### Instrumentation gaps (what changes vs `bun test`)

- **V8 provider is Node-only.** Vitest's docs: the v8 provider "Does not work on environments that don't use V8, such as Firefox or Bun. Or on environments that don't expose V8 coverage via profiler, such as Cloudflare Workers." On Node it is the recommended default; the istanbul provider "works on any JavaScript runtime" but transforms source first and is slower/heavier. ([Vitest coverage guide](https://vitest.dev/guide/coverage))
- **V8 reporting inaccuracy is largely closed.** Since Vitest `v3.2.0` the v8 provider uses AST-based remapping and "produces identical coverage reports to Istanbul." Residual limitations of the underlying `ast-v8-to-istanbul`: it "can't detect uncovered `AssignmentPattern`'s if line is otherwise covered" and "can't detect uncovered parts when block execution stops due to function throwing" (code after a throw is incorrectly reported covered). Both are false-*positive*-coverage edges; if the recipe's per-file 100% gate must not be gamed, prefer `provider: 'istanbul'` or accept the documented edges. ([Vitest 3.2 blog via guide](https://vitest.dev/guide/coverage); [ast-v8-to-istanbul README](https://github.com/AriPerkkio/ast-v8-to-istanbul))
- **Uncovered files must be opted in.** Vitest only reports "files that were imported during test run" unless `coverage.include` matches them (`include: ['src/**/*.{ts,tsx}']`). The Bun baseline measured a fixed target set via `bunfig.toml`; the Vitest recipe must set `coverage.include` explicitly or uncovered files silently vanish from the denominator. ([Vitest coverage guide](https://vitest.dev/guide/coverage))
- **The `*-bin.ts` exclusion still applies.** A subprocess entrypoint that is spawned, not imported, is never executed inside the instrumented process, so it has no coverage record under either provider. Keep the `coverage.exclude: ['**/*-bin.ts']` equivalent of the bunfig rule. ([`ast-v8-to-istanbul` limitations](https://github.com/AriPerkkio/ast-v8-to-istanbul) — coverage is collected from executed code; UNVERIFIED as a Vitest-specific statement, but the mechanism is the same V8/istanbul collection path)
- **Per-file thresholds do not cascade.** Vitest docs: "Glob patterns do **not** inherit the top-level `perFile`; set it on each glob explicitly." A recipe that adds per-directory thresholds must repeat `perFile` per glob. ([Vitest coverage config](https://vitest.dev/config/coverage))
- **Jest TS config needs a loader.** `jest.config.ts` requires `ts-node` or `esbuild-register` via a `@jest-config-loader` docblock. Vitest has no such requirement (it reads `vitest.config.ts` through Vite). ([Jest configuration](https://jestjs.io/docs/configuration))

Failure-mode class mirrored from Bun: the Bun gotcha "tsc and the coverage gate cannot be green with zero source files" becomes "Vitest exits non-zero on a threshold miss even with zero matching files unless `coverage.include` matches at least one real source file" — same class, same fix (a real `src/*.ts` + `test/*.test.ts` seed).

---

## 2. Mutation testing

### Bun baseline

`stryker.conf.mjs` uses `testRunner: "bun"`, `plugins: ["@hughescr/stryker-bun-runner"]`, `coverageAnalysis: "perTest"`, `thresholds: { high: 100, low: 100 }`, and crucially `bun.testFiles: [...]` (a list of test *directories*). The skill records: "The bun Stryker runner reads `bun.testFiles` (explicit list), NOT the top-level `testFiles` globs. Omit it and every mutant runs the full suite and times out." `@hughescr/stryker-bun-runner` 1.4.0 requires `bun >= 1.3.7` (its perTest correlation depends on Bun's TestReporter WebSocket events added in Bun 1.3.7) and peers `@stryker-mutator/core ^9.0.0 || ^10.0.0`. ([stryker-bun-runner README](https://github.com/hughescr/stryker-bun-runner); [registry](https://registry.npmjs.org/@hughescr/stryker-bun-runner/latest))

### npm/pnpm equivalent — Stryker's default runners

- **Vitest:** `@stryker-mutator/vitest-runner` 10.0.0 (`testRunner: "vitest"`), peer `vitest >= 2.0.0` and `@stryker-mutator/core 10.0.0`. Config file: `stryker.conf.mjs`. Command: `npx stryker run` (or `pnpm exec stryker run`). Runner options live under `vitest: { configFile, dir, related }`. ([Vitest runner docs](https://stryker-mutator.io/docs/stryker-js/vitest-runner/); [registry](https://registry.npmjs.org/@stryker-mutator/vitest-runner/latest))
- **Jest:** `@stryker-mutator/jest-runner` 10.0.0 (`testRunner: "jest"`), peer `@stryker-mutator/core 10.0.0`. Options under `jest: { projectType, configFile, config, enableFindRelatedTests }`. ([Jest runner docs](https://stryker-mutator.io/docs/stryker-js/jest-runner/); [registry](https://registry.npmjs.org/@stryker-mutator/jest-runner/latest))

`@stryker-mutator/core` 10.0.0 requires `node >= 22.0.0`. ([registry](https://registry.npmjs.org/@stryker-mutator/core/latest))

### What `bun.testFiles` maps onto

`bun.testFiles` is a runner-specific option; the cross-runner equivalent is Stryker's **top-level `testFiles`** array. The core schema documents it: "With `testFiles` you can limit which test files are executed during mutation testing. When specified, only tests from these files will be run… Glob patterns are supported." ([stryker-core.json](https://github.com/stryker-mutator/stryker-js/blob/master/packages/api/schema/stryker-core.json))

The vitest-runner consumes it directly: `dryRun` calls `testFilesProvided(options) ? await this.run({ testFiles: options.testFiles, relatedFiles: options.files }) : …`, and `run` passes the list to `this.ctx.start(testFilesToRun)`. The jest-runner passes it to Jest as positional args and, when present, suppresses `--findRelatedTests` (`const shouldFindRelatedTests = !testFiles && !!fileNamesUnderTest`). ([vitest-test-runner.ts](https://github.com/stryker-mutator/stryker-js/blob/master/packages/vitest-runner/src/vitest-test-runner.ts); [jest-test-adapter.ts](https://github.com/stryker-mutator/stryker-js/blob/master/packages/jest-runner/src/jest-test-adapters/jest-test-adapter.ts))

**Porting note:** the Bun recipe lists *directories* (`"factory-control/test/"`); Stryker's top-level `testFiles` is a glob list, so the recipe must translate directories into globs (`"factory-control/test/**/*.test.ts"`). The omp-factory `stryker.conf.mjs` already carries both forms side by side — the top-level `testFiles` globs are what the non-Bun runners will actually read.

### Failure modes / gotchas (mirroring the Bun class)

- **Forgetting `testFiles` ⇒ full-suite-per-mutant timeouts.** The same failure the skill records for `bun.testFiles` applies to the top-level `testFiles` on the Vitest/Jest runners: omit it and the initial dry run can still pass while per-mutant runs balloon.
- **`coverageAnalysis` is ignored by the vitest-runner.** Docs: "Your `coverageAnalysis` property is ignored. The vitest runner plugin will always use `"perTest"`." So the recipe's `coverageAnalysis: "perTest"` is a no-op there. ([Vitest runner docs](https://stryker-mutator.io/docs/stryker-js/vitest-runner/))
- **Non-overridable vitest options.** Stryker forces `threads: true`, `coverage: { enabled: false }`, `singleThread: true`, `watch: false`, `bail: options.disableBail ? 0 : 1`, `onConsoleLog: () => false`. Limitations: only `threads: true` is supported, and Browser Mode is unsupported. ([Vitest runner docs](https://stryker-mutator.io/docs/stryker-js/vitest-runner/))
- **`vitest.related` default can silently skip tests.** Default `true`; the runner warns "Vitest failed to find test files related to mutated files" when it finds none. Integration tests that call server code over HTTP don't import the source, so the recipe must set `vitest.related: false` for those areas. ([Vitest runner docs](https://stryker-mutator.io/docs/stryker-js/vitest-runner/))
- **Jest ESM needs an exec-arg.** `testRunnerNodeArgs: ["--experimental-vm-modules"]` in `stryker.conf` is required for ESM Jest. ([Jest runner docs](https://stryker-mutator.io/docs/stryker-js/jest-runner/))
- **Jest per-file `@jest-environment` docblocks must be remapped.** A custom `@jest-environment` in a file bypasses Stryker's coverage hook; it must become `@stryker-mutator/jest-runner/jest-env/<env>` or be mixin-wrapped. Coverage analysis with `perTest` also only supports `jasmine2`/`jest-circus`. ([Jest runner docs](https://stryker-mutator.io/docs/stryker-js/jest-runner/))
- **Threshold/timed-out semantics are unchanged.** Stryker counts `TimedOut` as killed for the score, and the json reporter accumulates across `--incremental` runs; the `stryker-gate-timeout-enforcement` procedure (reset report, scope bad-status counting to changed files, fail closed on a missing report) is runner-independent and carries over verbatim. ([skill://stryker-gate-timeout-enforcement])
- **pnpm strictness.** pnpm's non-hoisted `node_modules` means every Stryker plugin (`@stryker-mutator/core`, the runner) must be an explicit `devDependency`; an undeclared plugin will not resolve. ([pnpm install docs](https://pnpm.io/cli/install) — strictness is a pnpm property; UNVERIFIED as a Stryker-specific statement)

---

## 3. Coverage → Istanbul JSON bridge

### Bun baseline

Bun's coverage reporter emits `text` and `lcov` only, and its lcov "carries line hits (DA) but no per-function records (FN/FNDA)". fallow's `--coverage` flag requires an Istanbul `coverage-final.json`, so omp-factory ships `scripts/lcov-to-istanbul.ts` to synthesize the fnMap/FNDA records. `"fallow": "bun scripts/lcov-to-istanbul.ts --lcov coverage/lcov.info --out coverage/coverage-final.json && fallow health --coverage coverage/coverage-final.json"`. ([omp-factory `package.json` + `scripts/lcov-to-istanbul.ts`]; [fallow runtime-coverage docs](https://fallow.tools/docs/analysis/runtime-coverage/))

### Answer: no bridge is needed under Vitest or Jest

Both runners produce Istanbul JSON natively:

- **Vitest** — the `json` reporter is on by default (`coverage.reporter` default is `['text', 'html', 'clover', 'json']`), and it is an Istanbul reporter ("Coverage reporters to use. See istanbul documentation for detailed list"). Its output file defaults to `coverage-final.json` — the istanbul `json` reporter's own default is `this.file = opts.file || 'coverage-final.json'`. Both providers feed it: the v8 provider remaps to Istanbul-identical maps, and the istanbul provider is Istanbul natively. ([Vitest coverage config](https://vitest.dev/config/coverage); [istanbul-reports json/index.js](https://github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-reports/lib/json/index.js))
- **Jest** — `coverageReporters` default is `["clover", "json", "lcov", "text"]`, so `coverage/coverage-final.json` is written out of the box. ([Jest configuration](https://jestjs.io/docs/configuration))
- **fallow** — `fallow health --coverage <path>` takes "Istanbul JSON"; `fallow health --runtime-coverage` explicitly accepts "Single Istanbul coverage map JSON file — `./coverage/coverage-final.json`". ([fallow runtime-coverage docs](https://fallow.tools/docs/analysis/runtime-coverage/))

**What changes:** delete `scripts/lcov-to-istanbul.ts` and the `fallow` script's conversion step; point fallow directly at `coverage/coverage-final.json`. The fnMap/FNDA records the bridge had to invent are emitted natively, so CRAP scoring gets a real function map instead of a reconstructed one.

**Failure mode to guard:** if a recipe narrows `coverage.reporter` to `['lcov']` only, the `coverage-final.json` fallow needs disappears. Keep `json` in the reporter list (it is the default in both runners) or the audit silently falls back to static estimation.

---

## 4. Anti-slop lint plugin (`oxlint` + `@oxlint/plugins`)

### Bun baseline

`oxlint.config.ts` (a TypeScript config) registers the custom plugin with `jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }]`, where `index.ts` wraps 15 rules in `eslintCompatPlugin({ meta: { name: "anti-slop" }, rules: { … } })` from `@oxlint/plugins`. Command: `bun run lint` → `oxlint`. Deps: `oxlint ^1.79.0`, `@oxlint/plugins ^1.79.0`. ([omp-factory `oxlint.config.ts` + `tools/oxlint/anti-slop/index.ts`])

### Answer: the custom-plugin path is available outside Bun — it is Node-based

`oxlint`'s npm bin is `#!/usr/bin/env node` and imports the JS layer (`import "../dist/cli.js"`). Plugin loading happens in that JS runtime via a plain dynamic import: `loadPlugin` does `const plugin = (await import(url)).default as Plugin;` (the Rust side reaches it through a NAPI callback). `@oxlint/plugins` is an ordinary ESM package (`engines.node ^12.22.0 || ^14.17.0 || >=16.0.0`). So the anti-slop plugin is loaded by Node's ESM loader under npm/pnpm, exactly as it is by Bun's under Bun. ([npm/oxlint/bin/oxlint](https://github.com/oxc-project/oxc/blob/main/npm/oxlint/bin/oxlint); [src-js/plugins/load.ts](https://github.com/oxc-project/oxc/blob/main/apps/oxlint/src-js/plugins/load.ts); [registry](https://registry.npmjs.org/@oxlint/plugins/latest))

Package/config/command are unchanged: `oxlint` 1.87.0 (`engines.node ^20.19.0 || >=22.12.0`), `@oxlint/plugins` 1.87.0, config `oxlint.config.ts`, command `npx oxlint` / `pnpm exec oxlint`. ([registry](https://registry.npmjs.org/oxlint/latest))

### Failure modes / gotchas

- **TS plugin entry needs a TS-stripping runtime.** `./tools/oxlint/anti-slop/index.ts` is a TypeScript module loaded through `import()`. Node strips types by default since **v22.18.0 and v23.6.0** (stable in v24.12.0/v25.2.0). On an older Node the recipe must compile the plugin to `.js` or use a loader. oxlint's config docs state the same constraint for TS configs: "TypeScript configs require a Node runtime that can execute TypeScript (Node v22.18+ or v24+)." ([Node TypeScript docs](https://nodejs.org/docs/latest/api/typescript.html); [oxlint config docs](https://oxc.rs/docs/guide/usage/linter/config))
- **Explicit `.ts` import extensions are mandatory.** The plugin's `index.ts` already imports `./rules/x.ts`; Node type stripping requires explicit extensions (`import './file.ts'`, not `'./file'`), so this convention must be preserved. ([Node TypeScript docs](https://nodejs.org/docs/latest/api/typescript.html))
- **Standalone binaries are gone.** Since oxlint v1.17.0 the release archives contain only the Node addon; a recipe that fetches a standalone oxlint binary cannot load JS plugins. Use the npm package. ([oxc discussion #14452](https://github.com/oxc-project/oxc/discussions/14452))
- **JS plugins are alpha and partially ESLint-incompatible.** Docs: "JS plugins are currently in alpha"; not supported are "Custom file formats and parsers" and "Lint rules that rely on TypeScript type-awareness". So the anti-slop rules (all AST-only) port, but a type-aware rule would not. ([oxlint JS plugins docs](https://oxc.rs/docs/guide/usage/linter/js-plugins))
- **`before`/`after` hooks are not guaranteed per file.** The alternative `createOnce` API warns the `before` hook is not guaranteed to run on every file; per-file setup that must always run belongs in a `Program` visitor. The anti-slop plugin uses `eslintCompatPlugin`, which adds an ESLint-compatible `create` delegating to `createOnce` — behaviour is identical under oxlint and ESLint. ([oxlint writing JS plugins docs](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins))
- **Rule limits and `// SAFETY:` conventions are unchanged** — they are rule config in `oxlint.config.ts`, not runner-specific. (`skill://port-omp-factory-quality-harness`)

---

## 5. Biome assist actions

### Bun baseline

`biome.json` enables `assist` with ten `assist.actions.source.*` entries (`organizeImports`, `useSortedKeys`, `useSortedAttributes`, …), disables the linter (`linter.enabled: false` — oxlint owns linting), and uses an override to turn `useSortedKeys` off for `**/package.json`. `format:check` runs `biome format .`; the staged pre-commit step runs `biome check --staged --write --unsafe --linter-enabled=false --no-errors-on-unmatched`. ([omp-factory `biome.json` + `scripts/biome-staged.ts`])

### npm/pnpm equivalent — identical

Biome is a standalone binary distributed via npm; nothing about it is Bun-specific. The `biome.json` config schema is the same (`assist.enabled`, `assist.actions.source.<action>: "on" | "off"`; the docs example is `{"assist":{"enabled":true,"actions":{"source":{"useSortedKeys":"on"}}}}`). Assist actions are enforced by the `check` command, not `format`: "Assist actions can be enforced via CLI via `check` command… if you want to check only the assist actions, you should run `biome check --formatter-enabled=false --linter-enabled=false`." ([Biome assist docs](https://biomejs.dev/assist/))

Package `@biomejs/biome` 2.5.15 (`engines.node >=14.21.3`). Config `biome.json`. Commands `npx biome check` / `pnpm exec biome check` (and `npx biome format --write .` for the formatter-only path). ([registry](https://registry.npmjs.org/@biomejs/biome/latest))

**What changes:** only the invocation — replace `bunx`/`bun run` with `npx`/`pnpm exec`, and port `scripts/biome-staged.ts` to a Node-runnable script (`node scripts/biome-staged.ts` on Node 22.18+/24+ type stripping, or rename to `.mjs`). The `git update-index --again` re-stage step and the `MM`/`AM` guard are shell/git behaviour and are unchanged.

**Failure mode:** running `biome format` (or `biome check --formatter-enabled=false --linter-enabled=false` in the wrong direction) enforces only one half; assist actions like `organizeImports` are only enforced by `check`. The omp-factory staged script already passes `--linter-enabled=false` deliberately, so the recipe must keep `check` and add `--formatter-enabled=false` only when it wants assist alone. ([Biome assist docs](https://biomejs.dev/assist/))

---

## 6. Husky hooks and the `prepare` script

### Bun baseline

`package.json` has `"prepare": "husky"`; `.husky/pre-commit` runs `bun run biome:staged`/`lint`/`typecheck`, `.husky/pre-push` runs `bun run test` then `bun scripts/mutation-gate.ts` then `bun run fallow:audit`. `bun install` runs `prepare`, which installs the hooks via `core.hooksPath`. ([omp-factory `.husky/*`, `package.json`]; [skill://port-omp-factory-quality-harness])

### npm/pnpm equivalent — same wiring, different install triggers

husky 9.1.7 (`engines.node >=18`) is package-manager-agnostic: the docs' get-started gives `npm install --save-dev husky`, `pnpm add --save-dev husky`, `bun add --dev husky`, and `husky init` "creates a `pre-commit` script in `.husky/` and updates the `prepare` script in `package.json`". Config: `package.json` (`"prepare": "husky"`) + `.husky/`. ([husky get-started](https://typicode.github.io/husky/get-started.html); [registry](https://registry.npmjs.org/husky/latest))

Install-trigger matrix:

- **npm** runs `prepare` on `npm install` and `npm ci` (both run `… preprepare → prepare → postprepare`), but *not* when installing a specific package (`npm install express`). ([npm scripts docs](https://docs.npmjs.com/cli/v11/using-npm/scripts))
- **pnpm** runs the project's own lifecycle scripts during a full install — `preinstall, install, postinstall, preprepare, prepare, postprepare` in that order — on both the fresh and frozen paths, but **not** on `pnpm add <pkg>` (a partial/"installSome" mutation). ([pnpm PR #12051 quoting `pkg-manager/core/src/install/index.ts`](https://github.com/pnpm/pnpm/pull/12051); [pnpm scripts docs](https://pnpm.io/scripts))

### Failure modes / gotchas

- **CI/prod installs break `prepare`.** "If installing only `dependencies` (not `devDependencies`), the `"prepare": "husky"` script may fail because Husky won't be installed." Documented fixes: `"prepare": "husky || true"`, or a `.husky/install.mjs` guard that exits early when `NODE_ENV=production`/`CI=true` and use `"prepare": "node .husky/install.mjs"`. ([husky how-to](https://typicode.github.io/husky/how-to.html))
- **`--ignore-scripts` skips it.** pnpm's `--ignore-scripts` is documented as "Do not execute any scripts defined in the project `package.json` and its dependencies" — hooks then never install. ([pnpm install docs](https://pnpm.io/cli/install))
- **`HUSKY=0` on CI/Docker.** Set `HUSKY: 0` to avoid installing hooks on CI or in Docker. ([husky how-to](https://typicode.github.io/husky/how-to.html))
- **Hook scripts must be POSIX sh, not bash.** Husky docs: "Hook scripts need to be POSIX compliant." The Bun hook bodies are plain `bun run …` lines; the non-Bun version replaces them with `npm run …` / `pnpm exec …` (or `node scripts/mutation-gate.ts`), still POSIX. ([husky how-to](https://typicode.github.io/husky/how-to.html))
- **GUI / version-manager `command not found`.** Git hooks from GUIs don't inherit a version manager's `PATH`; source it in `~/.config/husky/init.sh`. ([husky how-to](https://typicode.github.io/husky/how-to.html))
- **The pre-push mutation gate script itself must run on Node.** `scripts/mutation-gate.ts` is TypeScript invoking `bunx stryker …`; the non-Bun port runs `node scripts/mutation-gate.ts` (Node 22.18+/24+ type stripping) or compiles it, and swaps `bunx stryker` for `npx stryker`/`pnpm exec stryker`. The gate's logic (diff pushed SHAs, group by area config, incremental cache, fail-closed report parsing) is runner-independent. ([skill://pre-push-mutation-gate]; [skill://stryker-gate-timeout-enforcement])

---

## 7. `.bun-version` → Node version pinning

### Bun baseline

A `.bun-version` file (`1.4.0`) at the repo root. In CI it is consumed by `oven-sh/setup-bun` via `bun-version-file: ".bun-version"`; when no version is given, setup-bun falls back to `package.json` `packageManager` then `engines.bun`. ([setup-bun README](https://raw.githubusercontent.com/oven-sh/setup-bun/main/README.md))

### npm/pnpm equivalent — `.node-version` / `.nvmrc`

The direct analogue is a `.node-version` (or `.nvmrc`) file consumed by `actions/setup-node@v7`'s `node-version-file` input: "The `node-version-file` input accepts a path to a file containing the version of Node.js to be used by a project, for example `.nvmrc`, `.node-version`, `.tool-versions`, `mise.toml`, or `package.json`." ([setup-node advanced usage](https://raw.githubusercontent.com/actions/setup-node/main/docs/advanced-usage.md))

Alternatives, all read by the same input:

- **`package.json`** — setup-node resolves, in order: `volta.node` → `devEngines.runtime` (entry with `"name": "node"`) → `engines.node` → `volta.extends` recursion. ([setup-node advanced usage](https://raw.githubusercontent.com/actions/setup-node/main/docs/advanced-usage.md))
- **`engines.node`** alone also drives npm/pnpm engine checks. ([npm scripts docs](https://docs.npmjs.com/cli/v11/using-npm/scripts))
- **pnpm version pinning** uses `package.json` `"packageManager": "pnpm@<version>"` with Corepack, not a separate file. ([setup-node README](https://raw.githubusercontent.com/actions/setup-node/main/README.md) — `packageManager` is the field setup-node reads for cache detection; Corepack is the pnpm-documented consumer)

**CI swap:** `uses: oven-sh/setup-bun@v2 with: { bun-version-file: ".bun-version" }` becomes `uses: actions/setup-node@v7 with: { node-version-file: ".node-version" }` (plus `cache: 'npm'|'pnpm'` if the recipe wants dependency caching). ([setup-bun README](https://raw.githubusercontent.com/oven-sh/setup-bun/main/README.md); [setup-node README](https://raw.githubusercontent.com/actions/setup-node/main/README.md))

### Failure modes / gotchas

- **setup-node caching for pnpm is off by default.** "Caching is disabled by default for pnpm and must be configured manually using the `cache` input." Only npm gets automatic caching (via `packageManager`/`devEngines.packageManager`). ([setup-node README](https://raw.githubusercontent.com/actions/setup-node/main/README.md))
- **`node-version` overrides `node-version-file`.** If both are set, the explicit `node-version` wins — a recipe that sets both can silently ignore the pin file. ([setup-node README](https://raw.githubusercontent.com/actions/setup-node/main/README.md))
- **pnpm on CI is frozen by default.** `--frozen-lockfile` defaults to `true` in CI when a lockfile is present, so a lockfile/manifest drift fails the install rather than updating. ([pnpm install docs](https://pnpm.io/cli/install))
- **Runtime vs package-manager version are different pins.** `.node-version` pins the Node runtime; the pnpm version comes from `packageManager` (Corepack) or the CI image, not from `.node-version`. ([setup-node README](https://raw.githubusercontent.com/actions/setup-node/main/README.md))

---

## Porting checklist (what the recipe library must branch on)

1. **Detect runtime** from `packageManager`/lockfile (`bun.lockb`/`bun.lock` vs `package-lock.json` vs `pnpm-lock.yaml`) and emit the Bun or the Node variant of each gate.
2. **Test+coverage:** Bun → `bun test` + `bunfig.toml` + custom `coverage-gate.ts`; Node → Vitest `perFile: { 100: true }` (or Jest per-glob thresholds) + `coverage.include` for uncovered files. Bun projects *using Vitest* must pick the `istanbul` provider (v8 is unsupported on Bun).
3. **Bridge:** drop `lcov-to-istanbul.ts` on Node; keep `json` in the reporter list.
4. **Mutation:** swap the runner plugin (`@hughescr/stryker-bun-runner` → `@stryker-mutator/vitest-runner`/`-jest-runner`) and translate `bun.testFiles` directories into top-level `testFiles` globs; keep the 100/100 thresholds and the fail-closed report gate.
5. **Lint:** unchanged oxlint + anti-slop plugin; ensure Node ≥22.18 for the TS plugin entry and use the npm package (no standalone binary).
6. **Format/assist:** unchanged `biome.json`; enforce with `biome check` via `npx`/`pnpm exec`.
7. **Hooks:** unchanged husky wiring; guard `prepare` for prod/CI and `--ignore-scripts`.
8. **Pins:** `.bun-version` → `.node-version`; CI `setup-bun` → `setup-node` with `node-version-file`; `packageManager` pins pnpm.

## Sources

Bun baseline: `skill://port-omp-factory-quality-harness`, `skill://pre-push-mutation-gate`, `skill://stryker-gate-timeout-enforcement`, and the omp-factory tree (`package.json`, `bunfig.toml`, `stryker.conf.mjs`, `oxlint.config.ts`, `biome.json`, `.husky/*`, `scripts/lcov-to-istanbul.ts`, `scripts/biome-staged.ts`).

Primary sources cited inline. Package versions read from the npm registry (`https://registry.npmjs.org/<pkg>/latest`) on 2026-10-08: `vitest@5.0.3`, `@vitest/coverage-v8@5.0.3`, `@vitest/coverage-istanbul@5.0.3`, `jest@30.5.2`, `@stryker-mutator/core@10.0.0`, `@stryker-mutator/vitest-runner@10.0.0`, `@stryker-mutator/jest-runner@10.0.0`, `@hughescr/stryker-bun-runner@1.4.0`, `oxlint@1.87.0`, `@oxlint/plugins@1.87.0`, `husky@9.1.7`, `@biomejs/biome@2.5.15`, `fallow@3.32.0`.
