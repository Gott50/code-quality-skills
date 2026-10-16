---
topic: coverage
question: >-
  What does a per-file coverage floor actually buy, and where does it lie? Why
  per-file beats a global percentage, what legitimately belongs in an ignore
  list (generated code, type-only files, entrypoints) and what does not, branch
  vs. line vs. function, and the failure mode of chasing the number. Which parts
  are enforceable — the floor itself, an ignore-list rule — and which are
  judgement?
verdict: >-
  A per-file floor buys one thing a global percentage cannot: it makes the
  denominator honest. A global number is an average over whatever files the
  runner happened to load, so an untested file is invisible rather than failing
  (Vitest's default is "only files that were imported during test run"; c8 and
  nyc need `--all` to count an unloaded file at 0%). Per-file floors plus an
  explicit `include` glob are the only combination that cannot be passed by
  simply not importing a file. The floor itself is fully enforceable and the
  library already enforces it (`bun-test-coverage` / `vitest-coverage`, gate
  `test` with `floor: coverage`). The ignore list is half-enforceable: the
  mechanism is a config key, but *what belongs in it* is judgement, because the
  only machine-checkable proxy — "does this file have executable statements?" —
  is not the same question as "can the test runner execute this file?". Branch
  coverage is the metric that would catch the most, and it is the one the
  library does not gate: neither baseline metric set includes it. The failure
  mode of chasing the number is not a gate at all — coverage measures execution,
  not verification — so it is an agent instruction.
sources:
  - https://vitest.dev/config/coverage
  - https://vitest.dev/guide/coverage
  - https://github.com/istanbuljs/nyc/blob/main/README.md
  - https://github.com/bcoe/c8/blob/main/README.md
  - https://jestjs.io/docs/configuration#coveragethreshold-object
  - https://github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-lib-coverage/lib/file-coverage.js
  - https://github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-lib-coverage/lib/coverage-summary.js
  - https://v8.dev/blog/javascript-code-coverage
  - https://github.com/AriPerkkio/ast-v8-to-istanbul#limitations
  - https://bun.sh/docs/test/code-coverage
  - https://www.typescriptlang.org/tsconfig#verbatimModuleSyntax
  - https://martinfowler.com/bliki/AssertionFreeTesting.html
---

# Coverage: what a per-file floor buys, and where it lies

## Why per-file beats a global percentage

A global percentage is an average, and an average hides its denominator. The
denominator is the set of files the runner loaded, and every runner defaults to
loading only what the tests touched:

- Vitest: "By default Vitest will show only files that were imported during test
  run. To include uncovered files in the report, you'll need to configure
  `coverage.include` with a pattern that will pick your source files"
  ([vitest.dev/guide/coverage](https://vitest.dev/guide/coverage)).
- c8: "By default v8 will only give us coverage for files that were loaded by
  the engine. If there are source files in your project that are flexed in
  production but not in your tests, your coverage numbers will not reflect
  this." `--all` is what "will be loaded into the report. If any of those files
  remain uncovered they will be factored into the report with a default of 0%
  coverage"
  ([c8 README](https://github.com/bcoe/c8/blob/main/README.md)).
- nyc: "By default, nyc only collects coverage for source files that are visited
  during a test... nyc will instrument all files if the `--all` flag is set"
  ([nyc README](https://github.com/istanbuljs/nyc/blob/main/README.md)).
- Bun states the same as a troubleshooting item: "Coverage only tracks files
  that are loaded"
  ([bun.sh/docs/test/code-coverage](https://bun.sh/docs/test/code-coverage)).

So a global threshold over a default run is a threshold over the files that
already have tests. The library's own recipe says it plainly: "**`coverage.include`**
— without it, a file no test imports vanishes from the denominator and the gate
passes on an untested file" (`library/recipes/vitest-coverage.md`).

Per-file is the second half. Vitest: "When `true`, each file is checked against
the top-level thresholds instead of the project-wide aggregate. When set to an
object, both are checked: the aggregate against the top-level thresholds, and
every file against these per-file minimums"
([vitest.dev/config/coverage](https://vitest.dev/config/coverage)). nyc: "To do
this check on a per-file basis (as opposed to in aggregate), set the `per-file`
option to `true`" ([nyc README](https://github.com/istanbuljs/nyc/blob/main/README.md)).
c8: "To check thresholds on a per-file basis run: `c8 check-coverage --lines 95
--per-file`" ([c8 README](https://github.com/bcoe/c8/blob/main/README.md)).
Jest goes further and lets the threshold be scoped to a glob or a path:
"Thresholds can be specified as global, as a glob, and as a directory or file
path"
([jestjs.io/docs/configuration](https://jestjs.io/docs/configuration#coveragethreshold-object)).

The library's gate is per-file and per-metric, and it is explicit that the
global fraction is *not* the gate: "The `global` fraction over the whole project
is the score view's comparison (`score.mjs`), not a gate's: a workspace member's
own run aggregates the member alone, and holding it to the workspace-wide
fraction would fail a member exactly at its recorded floor"
(`library/RECIPE-CONTRACT.md`). The gate script's rule is: "a file the baseline
records must meet its own `{lines: {hit, found}, functions: {hit, found}}` ...
a file it does not record must meet the recorded `global` fractions"
(`library/RECIPE-CONTRACT.md`).

**What it buys, precisely:** a new file cannot enter the repo untested. A file
the baseline does not record is held to the recorded global floor, so adding
`src/new.ts` with no test fails the gate on the next run
(`skills/code-quality-setup/scripts/SCORE-SCHEMA.md`). A global-only threshold
cannot do this, because the new file is simply not in the average until
something imports it.

## What legitimately belongs in an ignore list

The test is **"can the test runner execute this file?"**, not "is this file
hard to test?". Three categories pass it:

**Generated code.** Bun's own docs list it: "Exclude generated files:
`src/generated/**`, `**/*.generated.ts`"
([bun.sh/docs/test/code-coverage](https://bun.sh/docs/test/code-coverage)). The
file is not authored, so a floor on it measures the generator, not the project.

**Process entrypoints.** The library's recipes both carry this, and both state
the reason: "a thin process entrypoint that only ever runs as a subprocess is
never executed in-process, so it can never reach 100%"
(`library/recipes/vitest-coverage.md`); "a thin `import.meta.main` bootstrap that
only ever runs as a subprocess, which bun cannot instrument, so it can never
reach 100%" (`library/recipes/bun-test-coverage.md`). The convention is
`**/*-bin.ts`. Note the mechanism differs by runner: Vitest excludes it via
`coverage.exclude`, Bun via `coveragePathIgnorePatterns` — "the one setting that
cannot move to the command line: bun has no CLI flag for it"
(`library/recipes/bun-test-coverage.md`).

**Type-only files.** TypeScript's `verbatimModuleSyntax` makes the case: "any
imports or exports without a type modifier are left around. Anything that uses
the type modifier is dropped entirely" — `import type { A } from "a";` is
"erased away entirely"
([typescriptlang.org/tsconfig](https://www.typescriptlang.org/tsconfig#verbatimModuleSyntax)).
A file that is only types compiles to nothing, so it has no executable
statements. This is the one category that usually needs **no ignore entry at
all**: the library's rule is "A gate with nothing to measure (`found`/`total` 0)
is 100%" (`skills/code-quality-setup/scripts/SCORE-SCHEMA.md`), so a 0/0 file
passes. An ignore entry for it is redundant, and a redundant entry is the first
step toward an entry that hides something real.

**What does not belong:** a file that is merely below its floor, a directory
excluded to make the number green, a file whose tests are inconvenient. The
distinction is *cannot be executed* vs. *has not been executed*. The library's
ratchet exists precisely so the second case has a legitimate answer that is not
an ignore entry: the floor is recorded at the current level and only a drop
below it fails (`library/recipes/bun-test-coverage.md`).

**The sub-file escape hatch is a different tool.** `/* istanbul ignore next */`,
`/* istanbul ignore if */`, `/* istanbul ignore else */`, `/* istanbul ignore
file */` ([nyc README](https://github.com/istanbuljs/nyc/blob/main/README.md))
and `/* c8 ignore next */`, `/* c8 ignore start */` / `stop`
([c8 README](https://github.com/bcoe/c8/blob/main/README.md)) exclude a
statement or branch, not a file. nyc gives the canonical case: "perhaps you run
your tests on Linux, but there's some logic that only executes on Windows"
([nyc README](https://github.com/istanbuljs/nyc/blob/main/README.md)). This is
the same "cannot be executed" test at sub-file granularity, and it is the right
tool for a platform branch — not a file-level exclusion.

**The trap that makes an ignore hint silently inert.** Vitest transpiles
TypeScript with esbuild, "which strips all comments from the source codes", so
an ignore hint needs the `@preserve` keyword to survive: `/* v8 ignore if --
@preserve */` ([vitest.dev/guide/coverage](https://vitest.dev/guide/coverage)).
An ignore hint without it is not an error — it is a comment that no longer
exists by the time the instrumenter sees the file, so the line it was meant to
exclude fails the gate and the author cannot see why.

## Branch vs. line vs. function

The three metrics are not three views of one number; they have different
denominators and different blind spots.

**Line coverage is derived from statement coverage, not measured.** Istanbul's
`getLineCoverage()` "returns computed line coverage from statement coverage.
This is a map of hits keyed by line number in the source" — it maps each
statement to its start line and keeps the maximum hit count per line
([file-coverage.js](https://github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-lib-coverage/lib/file-coverage.js)).
Two consequences: a line with two statements counts once, and a line is covered
if *any* statement on it is hit. This is why the library's Vitest config floors
`statements` and not `lines`: "`lines` has a different denominator (a line with
two statements counts once), so flooring it with the statement fraction fails a
project exactly at its floor"
(`library/templates/vitest-coverage/vitest.config.ts`).

**Function coverage is the weakest.** `computeSimpleTotals('f')` counts a
function as covered when its hit count is non-zero — `covered:
Object.values(stats).filter(v => !!v).length`
([file-coverage.js](https://github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-lib-coverage/lib/file-coverage.js)).
A function called once, with no assertion, is 100%.

**Branch coverage is the only one that sees an untaken arm.**
`computeBranchTotals` counts each arm of each branch separately — `ret.covered
+= branches.filter(hits => hits > 0).length; ret.total += branches.length`
([file-coverage.js](https://github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-lib-coverage/lib/file-coverage.js)).
V8's own write-up gives the minimal example: block coverage "could detect that
the `else` branch of the conditional expression `: c` is never executed, while
function granularity coverage would only know that the function `f` (in its
entirety) is covered"
([v8.dev/blog/javascript-code-coverage](https://v8.dev/blog/javascript-code-coverage)).

**But branch coverage is also the noisiest, and its errors run both ways.** The
V8-to-Istanbul remapper documents two limitations: it is "unable to detect
uncovered `AssignmentPattern`'s if line is otherwise covered", and "unable to
detect uncovered parts when block execution stops due to function throwing" —
the code after a `throw` is unreachable but "incorrectly covered"
([ast-v8-to-istanbul#limitations](https://github.com/AriPerkkio/ast-v8-to-istanbul#limitations)).
So a branch floor can be red on code that is genuinely unreachable, and green on
code that was never reached.

**What the library gates, and what it does not.** The baseline records
`lines`/`functions` for Bun's lcov and `statements`/`functions` for Vitest's
Istanbul — "The metric names come from the source"
(`skills/code-quality-setup/scripts/SCORE-SCHEMA.md`). **Branches are in neither
set.** That is a deliberate gap, not an oversight: the schema records "both
metrics because both gates enforce both", and a metric the gate does not read
would be a floor that never fires. Adding a branch floor means adding a metric
to the baseline schema and a reader to both gate scripts — a schema change, not
a config tweak.

**Why per-metric and not one fraction.** "A single recorded fraction would be
enforced on two metrics, so a file at 4/10 lines and 0/1 functions would fail
the moment the floor was raised to its own line level. Each metric is recorded
and enforced on its own" (`skills/code-quality-setup/scripts/SCORE-SCHEMA.md`).

## The failure mode of chasing the number

Coverage measures execution, not verification. V8's definition is the honest
one: "Code coverage provides information about whether, and optionally how often
certain parts of an application have been executed"
([v8.dev/blog/javascript-code-coverage](https://v8.dev/blog/javascript-code-coverage)).
Fowler's *Assertion Free Testing* is the canonical failure: a project required a
JUnit test per public method, showed the client "all the tests and the green
bar", and "there weren't any assertions in the JUnit tests" — which still yields
100% coverage
([martinfowler.com/bliki/AssertionFreeTesting.html](https://martinfowler.com/bliki/AssertionFreeTesting.html)).
A per-file floor does not fix this; it makes the *file* honest, not the test.

Four mechanical failure modes are worth naming because they are properties of
the ratchet, not of the tests:

1. **The greenfield wall is unachievable, so it is ignored.** With no baseline
   "every floor is 100%, the greenfield wall" (`library/recipes/bun-test-coverage.md`).
   A repo that never raised a baseline is gated at 100% and the gate is red from
   day one — which trains everyone to ignore it. The ratchet exists to avoid
   this: the adoption flow writes the floor at the measured level so the gate is
   green on day one and only a *drop* fails.
2. **"Nothing to measure" reads as 100%.** The rule "A gate with nothing to
   measure (`found`/`total` 0) is 100%"
   (`skills/code-quality-setup/scripts/SCORE-SCHEMA.md`) is what makes a
   type-only file pass — and it is also what a broken instrumentation would
   report. The library guards the two ways this can happen: "A missing artifact
   with test files present is a real failure (the reporter did not write)", and
   "a floor file that cannot be read must not silently become 100%"
   (`library/templates/bun-test-coverage/scripts/coverage-gate.ts`).
3. **A tool's built-in threshold can be silently defeated.** Bun: "Outside
   `--parallel`, the check only runs when the `text` reporter is enabled (the
   default); a run with only `--coverage-reporter=lcov` currently exits 0
   regardless of the threshold"
   ([bun.sh/docs/test/code-coverage](https://bun.sh/docs/test/code-coverage)).
   This is why the library does not use `coverageThreshold` at all: the gate is
   its own script reading `coverage/lcov.info`, so the threshold cannot be
   bypassed by a reporter flag.
4. **An auto-raising floor turns unrelated work red.** Vitest's
   `thresholds.autoUpdate` "Update[s] all threshold values `lines`, `functions`,
   `branches` and `statements` to configuration file when current coverage is
   better than the configured thresholds"
   ([vitest.dev/config/coverage](https://vitest.dev/config/coverage)). The
   library's `--raise` is the opposite: it is explicit, it merges, and "the
   floor never falls" (`skills/code-quality-setup/scripts/SCORE-SCHEMA.md`). A
   floor that rises on its own makes every unrelated PR a candidate for a red
   build.

Two ratchet properties that are correct but surprising, and worth stating so
they are not mistaken for bugs: a **new** file must meet the recorded **global**
floor, not the floor of the file it was extracted from
(`skills/code-quality-setup/scripts/SCORE-SCHEMA.md`) — so extracting a
poorly-covered function into its own file fails until it is raised; and "a
recorded gate whose artifact is absent is **kept**, never dropped — dropping it
would fall back to the greenfield wall, which is stricter, not a raise"
(`skills/code-quality-setup/scripts/SCORE-SCHEMA.md`).

## Routing

| Practice | Gate? | Where it goes |
|---|---|---|
| Per-file floor, per metric | **Yes** — already gated | `bun-test-coverage` / `vitest-coverage`, gate `test` with `floor: coverage`. The gate script reads the baseline's per-file `{hit, found}` per metric and falls back to the recorded `global` for an unrecorded file. No change needed. |
| An explicit `include` glob (the honest denominator) | **Yes** — already gated | `vitest-coverage` (`coverage.include: ["src/**/*.ts"]`) and `bun-test-coverage` (bun has no `include`; the equivalent is that the gate script treats a missing artifact with test files present as a failure). A project whose source is not under `src/` must widen the glob — the recipe body says so. |
| Generated code excluded | **Yes** — config key | `coverage.exclude` (Vitest) / `coveragePathIgnorePatterns` (Bun). The *entry* is a project decision; the recipe ships only the `**/*-bin.ts` convention. |
| Process entrypoints excluded | **Yes** — config key | Same two keys; `**/*-bin.ts` is the shipped convention in both recipes. |
| Type-only files | **No entry needed** | The "nothing to measure is 100%" rule already passes a 0/0 file (`SCORE-SCHEMA.md`). An ignore entry for one is redundant. |
| *What* belongs in the ignore list | **Partly** — new gate | A new check that every `coverage.exclude` / `coveragePathIgnorePatterns` entry matches a file with zero executable statements, or is on an allowlist of known-uninstrumentable patterns (`*-bin.ts`, `generated/**`). This is a new `verify` step on `bun-test-coverage` / `vitest-coverage`, or a new recipe `coverage-ignore-audit`. The judgement — "cannot be executed" vs. "has not been executed" — is not gate-able. |
| *What* belongs in the ignore list | **No** | `library/practices/coverage-ignore-list.md` — the test is "can the test runner execute this file?", not "is this file hard to test?". A file below its floor is not an ignore candidate; the ratchet is the answer. |
| Inline ignore hints (`istanbul`/`v8`/`c8 ignore`) | **Partly** — lint rule | New rule `anti-slop/require-preserve-on-coverage-ignore` in `oxlint-anti-slop` / `oxlint-anti-slop-npm`: flag `/* istanbul ignore` / `/* v8 ignore` / `/* c8 ignore` without `-- @preserve` in a TS file, because esbuild strips the comment and the hint is silently inert ([vitest.dev/guide/coverage](https://vitest.dev/guide/coverage)). |
| Branch coverage | **No** — not gated | Neither baseline metric set includes branches (`SCORE-SCHEMA.md`). Gating it needs a new metric in `gates.coverage` and a reader in both gate scripts — a schema change plus a new recipe, not a config tweak. The V8 remapper's false positives/negatives ([ast-v8-to-istanbul#limitations](https://github.com/AriPerkkio/ast-v8-to-istanbul#limitations)) are the reason to be cautious. |
| Line vs. statement metric choice | **Yes** — already gated | `vitest-coverage` floors `statements` (Istanbul's `s` map) and `bun-test-coverage` floors `lines` (lcov `LH`/`LF`), each because that is the metric the source records. The rule is in `SCORE-SCHEMA.md`: "The metric names come from the source". |
| Chasing the number (assertion-free tests, gaming the denominator) | **No** | `library/practices/coverage-is-not-verification.md` — coverage measures execution, not verification; a per-file floor makes the file honest, not the test. The mutation floor (`stryker-mutation` / `stryker-mutation-vitest`) is the gate that measures assertion strength. |
| The ratchet's surprising properties (new file → global floor; absent artifact kept) | **Yes** — already gated | `bun-test-coverage` / `vitest-coverage` via `score.mjs --raise`'s merge rules (`SCORE-SCHEMA.md`). Documented, not changed. |

The `library/practices/*.md` files are a new surface: prose instructions the
`agent-guidance` recipe renders into `AGENTS.md` / `docs/code-quality.md`
alongside the gate table, so the judgement half of each practice reaches the
agent that writes the tests. The lint rule is a new template in the existing
`oxlint-anti-slop` / `oxlint-anti-slop-npm` recipes — no new recipe is needed
for it. The ignore-list audit is the one item that needs a new recipe or a new
`verify` step on the two coverage recipes.
