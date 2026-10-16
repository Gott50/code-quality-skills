---
topic: mutation
question: >-
  What makes a mutation score meaningful? Cover what a surviving mutant actually
  tells you, equivalent mutants and how to handle them, mutation score as a floor
  vs. a target, which files to exclude, the cost/time tradeoff, and when mutation
  testing is not worth it. Which parts are enforceable — the floor, the config —
  and which are judgement?
verdict: >-
  A mutation score is meaningful only as a floor on a scope you chose, measured
  on mutants you can act on. A survivor is a concrete test goal — a test that did
  not fail — not a bug report; it is meaningless when the mutant ran zero tests
  (stryker-js#6210) or is equivalent (undecidable; 10–40% of mutants). The score
  is a floor, never a target: the library ratchets it to the measured level and
  never lowers it, and PIT's author does not use a target at all. The enforceable
  half is the floor and the config (scope, ignore set, timeout, incremental, the
  gate's timeout/zero-test/missing-report checks); the judgement half is what a
  survivor means, whether to rewrite code to avoid an equivalent mutant, which
  files are production code, and whether to pay the cost at all.
sources:
  - https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/
  - https://stryker-mutator.io/docs/stryker-js/configuration/
  - https://stryker-mutator.io/docs/stryker-js/incremental/
  - https://stryker-mutator.io/docs/stryker-js/disable-mutants/
  - https://stryker-mutator.io/docs/mutation-testing-elements/equivalent-mutants/
  - https://stryker-mutator.io/docs/mutation-testing-elements/static-mutants/
  - https://stryker-mutator.io/docs/stryker-js/troubleshooting/
  - https://stryker-mutator.io/docs/stryker-js/vitest-runner/
  - https://stryker-mutator.io/docs/General/faq/
  - https://stryker-mutator.io/docs/General/dashboard/
  - https://github.com/stryker-mutator/stryker-js/issues/6210
  - https://github.com/hughescr/stryker-bun-runner/blob/develop/src/utils/bun-args.ts
  - https://pitest.org/faq/
  - https://blog.pitest.org/dont-let-your-code-dry/
  - https://research.google/pubs/state-of-mutation-testing-at-google/
  - https://homes.cs.washington.edu/~rjust/publ/mutation_testing_practices_icse_2021.pdf
  - https://doi.org/10.1109/tse.2010.62
  - https://doi.org/10.1109/c-m.1978.218136
  - library/RECIPE-CONTRACT.md
  - library/recipes/stryker-mutation.md
  - library/recipes/stryker-mutation-vitest.md
  - library/templates/stryker-mutation/stryker.conf.mjs
  - library/templates/stryker-mutation-vitest/stryker.conf.mjs
  - library/templates/stryker-mutation/scripts/mutation-gate.ts
  - skills/code-quality-setup/scripts/SCORE-SCHEMA.md
  - skills/code-quality-improve/references/raise.md
---

# Mutation

## What a surviving mutant actually tells you

A mutant is a small syntactic change to the source. Stryker gives each one a
state: **Killed** ("at least one test failed while this mutant was active"),
**Survived** ("all tests passed while this mutant was active. You're missing a
test for it"), **No coverage** ("isn't covered by one of your tests and survived
as a result"), **Timeout**, **Runtime error**, **Compile error**, **Ignored**,
**Pending** ([mutant-states-and-metrics](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)).
The score is `detected / valid * 100`, where `detected = killed + timeout` and
`valid = detected + undetected = killed + timeout + survived + no coverage`
(ibid.). The FAQ states the same arithmetic as `# Total detected / # Total
mutants * 100` and adds "mutants that resulted in an `error` are not used in the
calculation" ([faq](https://stryker-mutator.io/docs/General/faq/)).

So a survivor is a **test that did not fail**, not a bug report. Its meaning
rests on two hypotheses from the field's founding paper: the **Competent
Programmer Hypothesis** (programmers write programs close to correct, so faults
are few simple syntactic changes) and the **Coupling Effect** — "Test data that
distinguishes all programs differing from a correct one by only simple errors is
so sensitive that it also implicitly distinguishes more complex errors"
([Jia & Harman 2011](https://doi.org/10.1109/tse.2010.62), quoting
[DeMillo et al. 1978](https://doi.org/10.1109/c-m.1978.218136)). Google's
industrial data backs the coupling: "for 1043 (70%) of the bugs, mutation testing
would have reported a fault-coupled mutant in the bug-introducing change"
([ICSE 2021](https://homes.cs.washington.edu/~rjust/publ/mutation_testing_practices_icse_2021.pdf)).
Google treats a live mutant as a "concrete test goal, pointing out possible ways
to improve the test suite" (ibid.).

Three caveats make a survivor's signal weaker than it looks:

- **A survivor whose mutant run executed zero tests is meaningless, not merely
  low.** On Vitest 5 the per-test name filter matched nothing, so every covered
  mutant was reported `Survived` with `testsCompleted: 0` and the score collapsed
  from 47.36 to 2.96 on the same 2,637 mutants
  ([stryker-js#6210](https://github.com/stryker-mutator/stryker-js/issues/6210)).
  The library's gate fails on exactly this signature — "a covered survivor whose
  mutant run executed zero tests" — because "the score is meaningless rather than
  merely low and the exit code cannot see it"
  ([`mutation-gate.ts`](../library/templates/stryker-mutation/scripts/mutation-gate.ts)).
- **`No coverage` is a different signal from `Survived`.** It says no test
  executes the line, which coverage already reports; `Survived` says a test
  executes it and does not check the consequence. Stryker's `coverageAnalysis`
  exists to tell them apart: "This performance optimization does _not_ influence
  the resulting mutation testing score but does allow Stryker to distinguish
  between 'Survived' and 'NoCoverage'"
  ([configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)).
- **`Timeout` is counted as detected, and errors are excluded from the score.**
  "It is counted as 'detected'. The logic here is that if this mutant were to be
  injected in your code, your CI build would detect it because the tests will
  never complete" (mutant-states-and-metrics). The library's floor is stricter
  than Stryker's own score: `score.mjs` counts `killed` as `Killed` only and
  `total` as **every** mutant, so a `RuntimeError` or `CompileError` mutant holds
  a file below 100% "exactly like a survivor"
  ([`rank.mjs`](../skills/code-quality-improve/scripts/rank.mjs),
  [SCORE-SCHEMA](../skills/code-quality-setup/scripts/SCORE-SCHEMA.md)).

Finally, mutation testing answers a narrow question: it "is effective in guiding
testing to assess whether an algorithm is correctly implemented but not whether
the correct algorithm is implemented" (ICSE 2021).

## Equivalent mutants

An equivalent mutant is "syntactically different but functionally equivalent to
the original program" (Jia & Harman 2011). It can never be killed, so it is a
permanent survivor that says nothing about the tests.

- **Detection is undecidable.** "Automatically detecting all equivalent mutants
  is impossible … because program equivalence is undecidable" (Jia & Harman
  2011). Stryker says the same: "There is no definitive way for Stryker to find
  and ignore them. There is currently also no way yet to mark them to be
  ignored. For now, the only solution is by finding these by hand, which is time
  consuming and try to rewrite the code so it won't occur, or accept that you
  won't make 100%"
  ([equivalent-mutants](https://stryker-mutator.io/docs/mutation-testing-elements/equivalent-mutants/)).
- **They are common.** "Empirical results indicate that there are 10% to 40% of
  mutants which are equivalent" (Jia & Harman 2011). The consequence: "As the
  mutation score is counted based on non-equivalent mutants, without a complete
  detection of all equivalent mutants, the mutant score can never be 100%"
  (ibid.).
- **Stryker offers three handling mechanisms**, all of which mark the mutant
  `ignored` — "Mutants with this status in your report don't influence your
  mutation score but are still visible"
  ([disable-mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/)):
  1. `mutator.excludedMutations` — turn a mutator off entirely. "However,
     excluding a mutator for all your files is a shotgun approach."
  2. A `// Stryker disable` comment — `// Stryker [disable|restore]
     [next-line] *mutatorList*[: custom reason]`. The reason "will also end up in
     your report". This is the per-line tool.
  3. An ignore-plugin (`ignorers`) — a `shouldIgnore(path)` predicate over the
     AST, for a pattern that recurs across files.
- **Google's answer is to not generate them.** Its "arid node" heuristic
  suppresses mutation in nodes that cannot yield a productive mutant — logging,
  imports, return statements, time specifications, memory-reserving calls,
  memoization, and the `for`-loop `<` → `!=` case, which "usually results in the
  equivalent mutant and is suppressed". The paper is explicit that this is
  load-bearing: "The question of equivalence is unfortunately undecidable, so
  avoiding generating equivalent mutants is important", and "if we decide a
  certain mutation is not useful and that the whole class of mutants should not
  be created, the rule is added to the `expert` function. This is the critical
  part of the system because, without it, users would become frustrated with
  non-actionable feedback and opt out of the system altogether"
  ([ICSE-SEIP 2018](https://research.google/pubs/state-of-mutation-testing-at-google/)).

The library currently expresses **none** of these: `stryker.conf.mjs` has no
`excludedMutations`, no `ignorers`, and no `// Stryker disable` guidance
([`stryker.conf.mjs`](../library/templates/stryker-mutation/stryker.conf.mjs)).
Its only equivalent-mutant defence is the `mutate` scope, which excludes
`!**/*.d.ts` and `!**/*-bin.ts` (files whose mutants are mostly uninteresting)
but nothing semantic.

## Mutation score as a floor vs. a target

Stryker's `thresholds` are `{ high: 80, low: 60, break: null }`. Only `break`
fails a build — "`mutation score < break`: Error! Stryker will exit with exit
code 1" — while `high`/`low` "only colour the report". The default is
`break: null`: "Set `break` to `null` (default) to never let your build fail"
([configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)).
The library sets `break` from the committed baseline's `gates.mutation.global`,
rounded **down** so the config is never stricter than the recorded floor, and
`100` with no baseline — "any survivor fails, the greenfield wall"
([`stryker.conf.mjs`](../library/templates/stryker-mutation/stryker.conf.mjs)).

The floor itself is per-file exact fractions: a recorded file must meet its own
`{killed, total}` fraction, cross-multiplied so no float rounding creeps in; a
file the baseline does not record must meet the recorded `global` fraction; and
`--raise` **merges**, taking the larger of the current and recorded fractions, so
"the floor never falls" ([SCORE-SCHEMA](../skills/code-quality-setup/scripts/SCORE-SCHEMA.md)).
The improvement skill states the rule as a prohibition: "Never lower a floor to
make a gate green", and "The floor never rises on its own … only the raise step
moves a floor, and only after a change has been verified"
([raise.md](../skills/code-quality-improve/references/raise.md)).

That is a floor, not a target, and the distinction is deliberate. PIT's author,
who has run mutation testing for over a decade, rejects the target outright:
"Having setup mutation testing to run infrequently, many people try and make sure
the results aren't ignored by setting a target mutation score, so the build fails
if the mutation score drops below a certain level. Pitest supports this because
so many people asked for it, but it is not something I ever use myself. It
doesn't really solve the problem, and can actually make things worse." The reason
is timing: "The fundamental issue is you're still only looking at the mutation
testing results after all the work is 'done'. This late in the day surviving
mutants are a nuisance … You'll take the easy route to fix things, and that can
make a codebase worse in ways that are difficult to measure. Adding a test that's
highly coupled to the code is often easy. Adding one that isn't is much harder"
([dont-let-your-code-dry](https://blog.pitest.org/dont-let-your-code-dry/)).

Google goes further and does not compute a score at all: "the mutation score
itself is difficult to act on by developers", and "we were also unable to find a
good way to surface it to the engineers in an actionable way" (ICSE 2021). It
surfaces a sample of live mutants as code-review findings instead, capped at
"no more than seven mutants … per file in a changelist" (ibid.). The Stryker
dashboard exists to track the score over time, but it is a reporting surface, not
a gate ([dashboard](https://stryker-mutator.io/docs/General/dashboard/)).

So: the **floor** is enforceable and the library enforces it; the **target** —
what level to aim for, and whether to ratchet at all — is judgement.

## Which files to exclude

Stryker separates two settings. `mutate` selects what is mutated: "These should
be your _production code files_, and definitely not your test files." Its default
globs include `src`/`lib` and exclude `__tests__`, `test` and `spec`.
`ignorePatterns` selects what is copied to the sandbox at all: "patterns to all
files or directories that are not used to run your tests and thus should _not be
copied_". `node_modules`, `.git`, `*.tsbuildinfo` and `/stryker.log` are always
ignored, and "Overriding `--ignorePatterns` is only needed when you experience a
slow Stryker startup, because too many (or too large) files are copied to the
sandbox" ([configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)).

The library's `mutate` is `src/**/*.ts` with `!**/test/**`, `!**/*.test.ts`,
`!**/*.d.ts`, `!**/*-bin.ts`, `!**/coverage/**`. `scripts/` and `tools/` are
deliberately outside it, and the reason is a hard failure, not tidiness: "the bun
runner eagerly imports every file in the mutation set into the test process
('eager modules from mutate globs'), so a script whose top-level code exits
non-zero aborts the dry run for the whole push"
([`stryker.conf.mjs`](../library/templates/stryker-mutation/stryker.conf.mjs),
[`stryker-mutation.md`](../library/recipes/stryker-mutation.md)). Its
`ignorePatterns` adds `reports`, `coverage`, `tmp`, `.claude` and `.agents` —
the last two because "Stryker's sandbox copy dies with ENOTSUP on it (#138)"
(ibid.).

Two more exclusions matter:

- **Type-only files.** A push touching only type-only files instruments nothing
  and writes no report; the gate "fails closed on a missing report, unless
  Stryker's own `Instrumented <N> source file(s) with 0 mutant` line confirms a
  genuinely zero-mutant run" (`mutation-gate.ts`).
- **Static mutants.** A static mutant "is executed once on startup instead of
  when the tests are running", so per-test coverage cannot be measured and
  Stryker "would default to running all tests" — "a big performance penalty".
  `--ignoreStatic` drops them, and it "requires `coverageAnalysis: perTest`"
  ([configuration](https://stryker-mutator.io/docs/stryker-js/configuration/),
  [static-mutants](https://stryker-mutator.io/docs/mutation-testing-elements/static-mutants/)).
  The library does not set it.

Google's arid-line list is the industrial version of the same idea: logging,
imports, return statements, time specifications, memory-reserving calls,
memoization, and the `for`-loop `<` → `!=` case (ICSE-SEIP 2018).

## The cost/time tradeoff

Mutation testing is the most expensive gate in the library — `cost: heavy`, and
"the plan prints a warning beside it" ([RECIPE-CONTRACT](../library/RECIPE-CONTRACT.md)).
The levers, in the order the tools document them:

- **Scope to the change.** PIT: "The most effective way to use mutation testing
  is usually to limit analysis to the code that you are changing"
  ([pitest.org/faq](https://pitest.org/faq/)). The library's gate does this: it
  "diffs the pushed commits against the remote tip, and runs Stryker scoped to
  the changed files with `--incremental`" (`mutation-gate.ts`). "A full-suite run
  on every push is far too slow" (`stryker-mutation.md`).
- **Incremental caching.** "StrykerJS will track the changes you make to your
  code and tests and only runs mutation testing on the changed code. But, of
  course, it will still provide you with the full mutation report at the end!"
  The limitation is real: "Stryker will not detect any changes you've made in
  files other than mutated files and test files"
  ([incremental](https://stryker-mutator.io/docs/stryker-js/incremental/)).
- **Per-test coverage analysis.** `coverageAnalysis: perTest` (the default since
  Stryker 5) runs only the tests covering a mutant (configuration).
- **Concurrency.** Defaults to `n-1` logical cores (configuration).
- **Timeouts.** The halting problem forces a bound:
  `timeoutForTestRunMs = netTimeMs * timeoutFactor + timeoutMS + overheadMs`
  (configuration).
- **Fewer mutants.** PIT: "Limit the number of mutations per class. This will
  give you a less complete picture however" (pitest.org/faq). Google generates
  "at most one mutant per line" and suppresses arid nodes (ICSE-SEIP 2018).
- **Static mutants.** In one real run, "331 static mutants (13% of total) … are
  estimated to take 85% of the time running the tests!" (stryker-js#6210).

The library's vitest recipe pays a specific cost knowingly: it uses the `command`
runner because `@stryker-mutator/vitest-runner` 10.0.0 is broken on Vitest 5, and
"The cost is the whole suite per mutant instead of the covering tests; the gate
scopes `--mutate` to the changed files, which keeps that bounded"
([`stryker.conf.mjs` (vitest)](../library/templates/stryker-mutation-vitest/stryker.conf.mjs)).
The TypeScript checker is the same trade in the other direction: "adding
`typescript-checker` to StrykerJS makes types safety better and you get less
false negative results, but it comes with a performance cost"
([troubleshooting](https://stryker-mutator.io/docs/stryker-js/troubleshooting/)).

## When mutation testing is not worth it

- **When nobody acts on the result.** PIT: "Running mutation analysis is where
  all the cost is. You don't get any benefit until you look at the results and do
  something with them. Typically, if the analysis is run overnight, this doesn't
  happen in a meaningful fashion. The results are largely forgotten and ignored."
  And, bluntly: "you gain nothing by _running_ mutation analysis. Zero. Zilch.
  Nada." (dont-let-your-code-dry).
- **When the repo has no tests.** The library's recipe requires
  `{ testFile: true }` — a repo with no test file cannot have a green mutation
  gate, and the fix is the predicate, not a flag
  ([RECIPE-CONTRACT](../library/RECIPE-CONTRACT.md),
  [`stryker-mutation.md`](../library/recipes/stryker-mutation.md)).
- **When the question is out of scope.** 30% of Google's high-priority bugs were
  not coupled to any mutant; the reasons were a weak operator, a missing
  operator, or "no such mutation operator" — "bugs in higher-level
  specifications or protocols are outside of the scope of mutation testing"
  (ICSE 2021).
- **When the harness would lie.** The bun runner rejects flags that make the
  score meaningless rather than merely low: `--pass-with-no-tests` "turns a test
  selection that matched nothing into exit code 0, so such mutants are falsely
  scored as survived"; `--update-snapshots` "rewrites snapshots to match the
  mutated output, so snapshot tests can never fail and mutants falsely survive";
  `--cwd` "moves bun out of the Stryker sandbox, so tests run against the
  unmutated project and every mutant goes uncovered"
  ([bun-args.ts](https://github.com/hughescr/stryker-bun-runner/blob/develop/src/utils/bun-args.ts)).
- **When the runner is broken.** The vitest recipe requires `vitest-coverage`
  because "the `command` runner drives `npx vitest run`, so without that recipe
  there is no `vitest` to run" (`stryker-mutation-vitest.md`).

## Enforceable vs. judgement

**A gate or config can fail on it:**

- The floor: per-file exact `{killed, total}` fractions, cross-multiplied, with
  the recorded `global` for unrecorded files (SCORE-SCHEMA).
- `thresholds.break` read from the baseline, rounded down, `100` with no baseline
  (`stryker.conf.mjs`).
- The mutation scope (`mutate` globs) and the sandbox ignore set
  (`ignorePatterns`) (`stryker.conf.mjs`).
- The timeout (`timeoutMS`/`timeoutFactor`) and the incremental cache
  (`--incremental`) (`stryker.conf.mjs`, `mutation-gate.ts`).
- The gate's extra checks: any `Timeout` mutant fails whatever the floor, a
  zero-test survivor fails, and a missing report fails closed unless Stryker
  confirms a zero-mutant run (`mutation-gate.ts`).
- The runner's rejected flags (`bun-args.ts`).
- The `{ testFile: true }` predicate (RECIPE-CONTRACT).

**Judgement, not gateable:**

- What a survivor means for this code — a missing assertion, an equivalent
  mutant, or a coverage gap.
- Whether to rewrite the code to avoid an equivalent mutant, or accept <100%
  (equivalent-mutants).
- Whether to exclude a mutator globally (`excludedMutations`) or per line
  (`// Stryker disable`) (disable-mutants).
- Whether to aim for a target score, and what level (dont-let-your-code-dry).
- Which files are "production code" worth mutating (configuration).
- Whether to pay the cost at all, and how often (dont-let-your-code-dry).

## Routing

| Practice | Enforceable? | Where it goes |
|---|---|---|
| Mutation floor: per-file exact `{killed, total}` fractions, `global` for unrecorded files | Yes — gate | `stryker-mutation` / `stryker-mutation-vitest` gate `mutation` (`floor: mutation`). Exists. |
| `thresholds.break` from the baseline, rounded down, `100` with no baseline | Yes — config | `stryker.conf.mjs` (both recipes). Exists. |
| Mutation scope (`mutate` globs) | Yes — config | `stryker.conf.mjs` (both recipes). Exists. |
| Sandbox ignore set (`ignorePatterns`) | Yes — config | `stryker.conf.mjs` (both recipes). Exists. |
| Timeout (`timeoutMS`/`timeoutFactor`) | Yes — config | `stryker.conf.mjs` (both recipes). Exists. |
| Incremental cache (`--incremental`) | Yes — config | `stryker.conf.mjs` + `mutation-gate.ts`. Exists. |
| Timeout / zero-test-survivor / missing-report checks | Yes — gate | `scripts/mutation-gate.ts`. Exists. |
| Runner flag rejection (`--pass-with-no-tests`, `--update-snapshots`, `--cwd`, …) | Yes — config | `@hughescr/stryker-bun-runner` `bun-args.ts`. Exists. |
| `{ testFile: true }` predicate | Yes — contract | `library/RECIPE-CONTRACT.md`. Exists. |
| Equivalent-mutant suppression (`excludedMutations`, `// Stryker disable`, `ignorers`) | Partly — config, not wired | New template: add `mutator.excludedMutations` / `ignorers` to `stryker.conf.mjs` (both recipes). The per-line `// Stryker disable` comment is a source-level convention → `library/practices/equivalent-mutants.md`. |
| Static-mutant handling (`--ignoreStatic`) | Partly — config, not wired | New template: add `ignoreStatic` to `stryker.conf.mjs` (both recipes); requires `coverageAnalysis: perTest`. |
| TypeScript checker (`checkers: ["typescript"]`) | Partly — config, not wired | New template: add `checkers` + `tsconfigFile` to `stryker.conf.mjs`; the cost/accuracy trade is `library/practices/mutation-type-checker.md`. |
| Which files are production code | No | `library/practices/mutation-scope.md` |
| What a survivor means | No | `library/practices/surviving-mutant.md` |
| Floor vs. target | No | `library/practices/mutation-floor-vs-target.md` |
| Whether to run mutation testing at all, and how often | No | `library/practices/mutation-cost.md` |
| Whether to rewrite code to avoid an equivalent mutant | No | `library/practices/equivalent-mutants.md` |

The `library/practices/*.md` files are a new surface: prose instructions the
`agent-guidance` recipe renders into `AGENTS.md` / `docs/code-quality.md`
alongside the gate table, so the judgement half of each practice reaches the
agent that writes the tests
([`agent-guidance.md`](../library/recipes/agent-guidance.md)). The config
additions are new templates in the existing `stryker-mutation` /
`stryker-mutation-vitest` recipes — no new recipe is needed for any of them.
