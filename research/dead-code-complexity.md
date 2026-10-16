---
topic: dead-code-complexity
question: >-
  What should a dead-code and complexity gate actually fail on? Unreachable code vs. unused
  exports, complexity thresholds and their false positives, baselines vs. walls, and the
  difference between a finding worth fixing and one worth baselining. Which are enforceable
  and which are judgement?
verdict: >-
  Three different detectors are conflated under "dead code": statement reachability (a compiler
  question), symbol reachability (a graph question), and file reachability (also a graph
  question). Only the graph ones are worth a gate, and only as a ratchet: a wall on unused
  exports fails every repo that has a public API or a framework convention, so the enforceable
  form is "new findings fail, known findings pass" (fallow `--gate new-only` + a committed
  baseline). Complexity is enforceable the same way, but the threshold is a reporting filter and
  the rule severity is the gate — two knobs, and only the second one fails a build. The
  judgement residue is real and irreducible: whether an export is public API, whether a complex
  function is intentional, and whether a finding is worth fixing or worth baselining cannot be
  decided by any of these tools, and the library should carry that as agent instruction, not as
  a gate.
sources:
  - https://fallow.tools/docs/explanations/dead-code/
  - https://fallow.tools/docs/analysis/dead-code/
  - https://fallow.tools/docs/cli/dead-code/
  - https://fallow.tools/docs/cli/health/
  - https://fallow.tools/docs/explanations/health/
  - https://fallow.tools/docs/cli/audit/
  - https://fallow.tools/docs/cli/global-flags/
  - https://fallow.tools/docs/configuration/rules/
  - https://fallow.tools/docs/configuration/suppression/
  - https://fallow.tools/docs/configuration/overview/
  - https://fallow.tools/docs/adoption/
  - https://fallow.tools/docs/analysis/auto-fix/
  - https://fallow.tools/docs/analysis/type-aware/
  - https://fallow.tools/docs/analysis/limitations/
  - https://fallow.tools/docs/integrations/ci/
  - https://www.typescriptlang.org/tsconfig/allowUnreachableCode.html
  - https://www.typescriptlang.org/tsconfig/noUnusedLocals.html
  - https://www.typescriptlang.org/tsconfig/noUnusedParameters.html
  - https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-unused-vars.html
---

# Dead code and complexity: what a gate can fail on

## 1. "Dead code" is three different questions

The phrase covers three detectors with three different failure modes, and a gate that does not
say which one it means will fail on the wrong thing.

**Statement reachability** is a compiler question. TypeScript's `allowUnreachableCode` is
`undefined` by default, which "provide[s] suggestions as warnings to editors"; `true` ignores
unreachable code; `false` "raises compiler errors about unreachable code"
([tsconfig/allowUnreachableCode](https://www.typescriptlang.org/tsconfig/allowUnreachableCode.html)).
The scope is narrow and stated: "These warnings are only about code which is provably unreachable
due to the use of JavaScript syntax" — a `return` followed by more statements — and it "does not
affect errors on the basis of code which *appears* to be unreachable due to type analysis"
(ibid.). So this is a small, high-precision, zero-false-positive class: a statement after a
`return`/`throw`/`break` in the same block. It is the one dead-code class that is safe as a wall.

**Symbol reachability** is a graph question. fallow's `unused-exports` reports "Exported symbols
that no other module imports", and `unused-types` reports "Type aliases and interfaces that no
module references"
([explanations/dead-code](https://fallow.tools/docs/explanations/dead-code/)). This is not
statement reachability: the code runs, it is simply never called from inside the repo. The
detector is a module graph walked from entry points, built with Oxc and `oxc_semantic` scope
analysis, and it "does not run the TypeScript compiler and does not use type information"
([analysis/dead-code](https://fallow.tools/docs/analysis/dead-code/)).

**File reachability** is the same graph, one level up: `unused-files` is "Files that no entry
point reaches"
([explanations/dead-code](https://fallow.tools/docs/explanations/dead-code/)).

The three are not independent, and fallow deliberately collapses one into another: when a file is
unused, "it does not list the unused exports, unused types, unused class members, and unused enum
members in that file", because "deleting the file removes them"; the hidden count is reported as
`cascade_hidden` and listed only with `--show-cascade`
([analysis/dead-code#findings-in-unused-files](https://fallow.tools/docs/analysis/dead-code/)).
A gate that counts findings must therefore read `total_issues` (which "count[s] only the findings
in the report") and not a sum of the per-category arrays, or it double-counts a file and its
contents.

**In-file unused bindings** are a fourth, separate class, owned by the linter and the compiler,
not the graph: TypeScript's `noUnusedLocals` "Report errors on unused local variables" and
`noUnusedParameters` "Report errors on unused parameters in functions", with parameters "starting
with an underscore (`_`) … exempt"
([noUnusedLocals](https://www.typescriptlang.org/tsconfig/noUnusedLocals.html),
[noUnusedParameters](https://www.typescriptlang.org/tsconfig/noUnusedParameters.html)). oxlint's
`no-unused-vars` covers the same ground and states its own boundary: it "ignores `.d.ts`,
`.astro`, `.svelte` and `.vue` files entirely", because "Oxlint does not support parsing template
syntax" and so "cannot tell if a variable is used or unused" there; an exported variable counts as
used; and the default `argsIgnorePattern` is `^_` "except for the bare `_` parameter"
([oxc no-unused-vars](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-unused-vars.html)).

**Consequence for the library.** The current `tsconfig-strict` template does not set
`noUnusedLocals` or `noUnusedParameters` — its `compilerOptions` are `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
`noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `moduleDetection`,
`moduleResolution`, `allowImportingTsExtensions`, `noEmit`, `skipLibCheck`, `target`/`lib`,
`types` (`library/templates/tsconfig-strict/tsconfig.json`). And the current `oxlint-anti-slop`
config enables the 15 anti-slop rules plus the size/complexity caps, but not `no-unused-vars`
(`library/templates/oxlint-anti-slop/oxlint.config.ts`). So the in-file class is currently
ungated in both places, and the two options are the cheapest real coverage the library is missing.

## 2. Complexity: the threshold is a filter, the rule is the gate

fallow separates two knobs that are easy to conflate. The **threshold** decides which functions
appear as findings; the **rule severity** decides whether a finding fails the run. "The thresholds
decide which functions have a finding. The rules `complexity-cyclomatic`, `complexity-cognitive`,
and `complexity-crap` decide if a finding fails the run. They default to `error`"
([cli/health](https://fallow.tools/docs/cli/health/)). Setting a threshold lower does not fail
more builds; it reports more. Setting a rule to `warn` keeps the finding in every output format
and exits 0 (ibid.).

The defaults and their provenance:

| Metric | Default | Meaning | Source |
|---|---|---|---|
| Cyclomatic | 20 | 1 + decision points; "the practical upper bound of 20 comes from NIST SP 500-235" | [explanations/health](https://fallow.tools/docs/explanations/health/) |
| Cognitive | 15 | nesting depth, labelled `break`/`continue`, recursion, logical-operator sequences; "the same as the SonarSource default rule" | ibid. |
| CRAP | 30 | `CC^2 × (1 - cov/100)^3 + CC`; Savoia & Evans, Agitar Labs, 2007 | ibid. |
| Unit size | 60 LOC | reported as a "large function" | [configuration/overview#health](https://fallow.tools/docs/configuration/overview/) |

The two complexity metrics are not redundant, and the docs give the counterexample that makes the
point: a flat `switch` scores cyclomatic 6 / cognitive 1 ("easy to read"), while a three-deep
`if` chain scores cyclomatic 4 / cognitive 9 ("harder to follow")
([explanations/health](https://fallow.tools/docs/explanations/health/)). A gate on cyclomatic
alone therefore fails readable dispatch tables and passes unreadable nesting.

**The false positives are documented, not hypothetical.** fallow's own limitations list names
them: "Generated files (GraphQL codegen, Prisma client, OpenAPI types) can have high complexity
density, but you should not refactor them"; "Test files with many `it()`/`test()` blocks can have
high cyclomatic complexity. This is usually fine"; "Config files (Webpack, ESLint) can show up as
hotspots, because they change often during setup"; "MI scores are not portable"; "Hotspot scores
are relative to your project. A score of 80 means 'worst in your project,' not 'objectively bad'"
([explanations/health#limitations](https://fallow.tools/docs/explanations/health/)). The
recommended mechanism for a known-legacy function is a **documented local ceiling**, not a
suppression: `health.thresholdOverrides[]` "can set `maxCyclomatic`, `maxCognitive`, `maxCrap`,
and `maxUnitSize`" and "can include a `reason`", and "Overrides keep the exceptions visible in the
output. Suppression comments hide them"
([cli/health](https://fallow.tools/docs/cli/health/)). The library's own oxlint config already
applies the same idea in the other direction, exempting test files from the line and statement
caps through `overrides` because "the caps force coverage-degrading condensation"
(`library/recipes/oxlint-anti-slop.md`).

**CRAP is the one complexity metric that is a correctness signal rather than a style signal**, and
it is the one that needs coverage data to mean anything. Without `--coverage`, fallow estimates
coverage from the module graph (`static_estimated`: "directly test-referenced = 85%, transitively
test-reachable = 40%, not test-reachable = 0%"), and the docs name the error in both directions:
"False negatives: When tests import a file but never run some of its functions, those functions
score lower (look healthier) than they should. False positives: When only non-test code references
a file, but tests do cover it through indirect paths, the file can score worse than it should"
([explanations/health#static-estimation-vs-real-coverage](https://fallow.tools/docs/explanations/health/)).
A CRAP gate without a coverage artifact is therefore a gate on an estimate, and the library
already encodes that dependency: `fallow-audit` `requires: [{ recipe: bun-test-coverage }]` and
`fallow-audit-npm` `requires: [{ recipe: vitest-coverage }]`, because "without that recipe there
is no coverage to score against" (`library/recipes/fallow-audit.md`).

## 3. Baselines vs. walls

The library's own contract states the distinction precisely. A gate **with** `floor` reads its
level from a committed baseline; a gate **without** `floor` "is a wall at a fixed level — a
formatter's zero-diff gate has no floor". And the fallback is explicit: "With **no baseline** — or
a baseline whose gate was never raised — the floor falls back to the greenfield wall: 100% for
coverage and mutation, 0 for lint and typecheck, and fallow's report-only mode. A repo that never
raised a baseline is therefore gated exactly as before the floor existed. A gate whose floor file
exists but is unreadable fails closed: a floor that cannot be read must not silently become the
wall" (`library/RECIPE-CONTRACT.md`).

fallow implements the same shape with two independent mechanisms, and they are not
interchangeable:

- **`--gate new-only`** (the default) "Compare[s] against the base ref and fail[s] only on
  findings that the current changeset introduces. JSON reports inherited findings in
  `attribution` and marks them `introduced: false`." `--gate all` is "Strict mode. Fail on every
  finding in changed files, including findings inherited from the base ref"
  ([cli/audit](https://fallow.tools/docs/cli/audit/)).
- **`--baseline <PATH>`** "Compare[s] against a previously saved baseline file" and reports "only
  new findings" ([cli/global-flags](https://fallow.tools/docs/cli/global-flags/)).

The two compose, and the library uses both: `fallow:audit` runs `fallow audit --gate new-only`
with `--dead-code-baseline` and `--health-baseline` when those files exist
(`library/templates/fallow-audit/package.json`).

**A baseline is not a wall, and the difference is the whole point.** A wall says "zero findings,
forever". A baseline says "no *new* findings; the recorded ones are grandfathered". The adoption
guide frames the choice as a rollout strategy: Option A "warn-everywhere" — "CI never blocks" —
with the stated risk that "a gate that only warns can stay that way forever"; Option B
"error + baselines" — "CI blocks on new issues. Existing debt in the files that a PR touches is in
the baseline, so it does not block" ([adoption](https://fallow.tools/docs/adoption/)).

**Three failure modes of a baseline gate, all documented:**

1. **A baseline that is regenerated too often is a wall that never fires.** "Regenerate them on a
   schedule (quarterly, or per release), not per merge. If you regenerate them per merge, new debt
   goes into the baseline each time CI runs, and nobody sees it" (ibid.).
2. **A baseline that has gone stale silently stops suppressing.** "When a quarter or more of the
   saved baseline entries match no current issue, the run prints a partial-staleness warning on
   stderr with the command to save the baseline again"
   ([cli/dead-code](https://fallow.tools/docs/cli/dead-code/)). `--fail-on-stale-baseline` "Exit[s]
   1 when the loaded baseline has an entry that matched nothing in this run"
   ([cli/global-flags](https://fallow.tools/docs/cli/global-flags/)).
3. **A baseline can be grown in the same commit that adds the finding.** "`--baseline` and
   `--fail-on-stale-baseline` pass when a change adds a finding and saves the baseline again in
   the same commit. `--fail-on-baseline-growth` stops this" (ibid.). It "Exit[s] 1 when a loaded
   baseline has a key that the same file at the base ref does not have. This makes a committed
   baseline shrink-only" (ibid.).

**The audit cannot judge a baseline, and the docs say so twice.** "An audit analyzes only the
files that changed against its base. A whole-project baseline therefore matches less of the run.
The narrow scope causes this, not a stale baseline. An audit loads the baselines that you pass,
but it does not judge them." All three sub-passes report `change_scoped: true` and
`gate_trips: false`, and the instruction is blunt: "Do not build a gate on these values." An
audit that loaded a baseline also sets `gate_outcomes["stale-baseline"]` to
`{"status": "skipped", "enforced": false}`, and "`audit` accepts `--fail-on-stale-baseline`, but in
audit this gate never runs" ([cli/audit#audit-cannot-judge-a-baseline](https://fallow.tools/docs/cli/audit/)).
`--fail-on-baseline-growth` *does* run in audit, because it "does not judge the findings of the
run. It compares each file of `--dead-code-baseline`, `--dupes-baseline` and `--health-baseline`
with the same file at the base ref, so a scoped run can judge it" (ibid.).

**Gate on the verdict, not on a count.** The audit JSON has three counts that look alike and
answer different questions — `verdict` (severity-aware), `attribution.*_introduced` (not
severity-aware), and `summary.*` (not severity-aware) — and the docs give the rule: "branch on
`verdict == "fail"`, or check the exit code, which follows the verdict. Do not count introduced
findings. A count brings back the bug that `command: audit` was built to fix: a project with
`unused-exports: warn` would fail CI on every PR that adds a warn-tier finding, although the
verdict correctly says `warn`" ([cli/audit#json-contract](https://fallow.tools/docs/cli/audit/)).

**Two baseline-key properties decide whether a baseline survives ordinary edits.** A dead-code
baseline "stores one line-free key for each finding: the rule, the path and the names. When you
add lines above a finding, the baseline still hides it. Each saved entry hides one finding, so a
second finding with the same key is new" ([analysis/dead-code#baseline-comparison](https://fallow.tools/docs/analysis/dead-code/)).
A health baseline defaults to `--baseline-mode count` ("per file and finding category") and offers
`identity` ("per function, identified by file path and function name"), with the caveat that
"`identity` works only with a baseline that you saved with `--baseline-mode identity`. When you
rename or move a function, save the baseline again" ([cli/health](https://fallow.tools/docs/cli/health/)).
The growth gate inherits the same asymmetry: "In a dead-code baseline with line-free keys
(`"identity": "dc1"`), one more occurrence of a key also counts as growth. A moved line does not.
The `dupes` and `health` baseline keys did not change" ([cli/global-flags](https://fallow.tools/docs/cli/global-flags/)).

**A floor that cannot be read must fail closed, and a floor that is not read must not be
mistaken for a pass.** The library's contract already says the first. The second is fallow's
`degrades_analysis` diagnostic: "An input that failed to load is a different case. It adds zeros,
and a zero looks like a clean measurement. Before you trust a zero, look in
`workspace_diagnostics[]` for an entry with `degrades_analysis: true`"
([explanations/health#health-score](https://fallow.tools/docs/explanations/health/)). The CI
integration turns that into a gate input: `fail-on-empty-analysis` — "Fail the job when the run
analyzed no source file. In that case every count is zero because the run measured nothing, not
because the project is clean. By default the run warns and passes"
([integrations/ci](https://fallow.tools/docs/integrations/ci/)).

## 4. Worth fixing vs. worth baselining

fallow publishes a fix order, and it is a correctness-first order, not an alphabetical one:
unresolved imports, unlisted dependencies, boundary violations, unused files, unused dependencies,
unused exports, circular dependencies, type-only dependencies, test-only dependencies, duplicate
exports, stale suppressions, unused types / enum members / class members. The rationale is stated:
"The first two categories are correctness issues that can cause runtime failures. The others are
maintenance and hygiene"
([explanations/dead-code#prioritizing-findings](https://fallow.tools/docs/explanations/dead-code/)).

The same page gives the per-issue "when to act" and, more usefully, the "when it's OK to keep"
list, which is the boundary between fix and baseline:

- **Unused files** — "When to act: Almost always." The false positives are scripts run directly
  and files loaded by tools fallow does not know about; both are fixed by declaring an entry
  point, not by baselining (ibid.).
- **Unused exports** — "Remove most unused exports, or remove their `export` keyword." Keep them
  when they are "Library public API" (mark with `/** @public */`, add the entry point to `entry`,
  or use `ignoreExports`) or "Convention-based exports" that "Frameworks use … through naming
  conventions" (ibid.).
- **Unused types** — keep for "Shared type packages" by adding the package entry point to `entry`
  (ibid.).
- **Unused class members** — "Remove the member or mark it as `private`. An unreferenced public
  method is either dead functionality or wired at runtime. Investigate both cases" (ibid.).

**The mechanism matters as much as the decision.** The adoption guide's decision tree prefers, in
order: `@public`/`@internal`/`@beta`/`@alpha` JSDoc tags, then `publicPackages`, then
`ignoreExports` "only when no other mechanism can express a file-level or export-level exception";
built-in plugin detection, then `entry`, then `dynamicallyLoaded`; `ignorePatterns` for generated
code; `ignoreDependencies` for runtime-provided packages; `/** @expected-unused */` for "One-off
intentional unused export"; and inline `// fallow-ignore-next-line` only for "One-off false
positive" ([adoption#4](https://fallow.tools/docs/adoption/)). The suppression page states the
rule: "Do not suppress an issue that repeats across the codebase. If a pattern affects many files,
configure it at the project level"
([configuration/suppression](https://fallow.tools/docs/configuration/suppression/)).

**Two properties make the "keep" mechanisms auditable rather than a graveyard.** First,
`@expected-unused` is checked for staleness while visibility tags are not: "Fallow checks this tag
for staleness, which it does not do for visibility tags (`@public`, `@internal`). If another
module imports the export later, fallow reports the tag as a stale suppression" (ibid.). Second,
the `stale-suppressions` rule (default `warn`) reports "`fallow-ignore` comments or
`@expected-unused` JSDoc tags that no longer match any issue"
([configuration/rules](https://fallow.tools/docs/configuration/rules/)). A repo that baselines
without ever promoting `stale-suppressions` to `error` accumulates suppressions that no longer
suppress anything.

**Auto-fix is deliberately narrower than detection, and the gap is the review surface.**
`fallow fix` "removes unused exports and unused dependencies"; it "does not delete entire files";
and it "removes a class method only when two conditions are true: type-aware analysis gives
complete evidence that the method is unused, and the declaration still matches the analyzed
source" ([analysis/auto-fix](https://fallow.tools/docs/analysis/auto-fix/)). When the analysis is
incomplete, findings carry `reachability_caveats` and "fallow does not offer its removal" in
`fallow fix`, editor quick fixes, MCP fixes, or one-click review suggestions (ibid.). The
`auto_fixable` flag is per-finding, not per-action-type: "The same action type can have
`auto_fixable: true` on one finding and `auto_fixable: false` on another" (ibid.).

**Verify before you delete.** "Before you act on a finding, check it with `--trace`. A finding is
only as correct as the fallow module graph. If code uses an export through a dynamic pattern that
fallow cannot resolve, `--trace` shows it"
([explanations/dead-code#limitations](https://fallow.tools/docs/explanations/dead-code/)). The
type-aware pass exists for exactly this: "Fallow removes a dead-code candidate only when the
checker resolves the exact identity of its declaration. When the analysis is partial or
unavailable, fallow keeps the original finding and reports a stable omission reason", and
`--type-aware-require complete` "fail[s] the CI job when semantic evidence is incomplete"
([analysis/type-aware](https://fallow.tools/docs/analysis/type-aware/)).

## 5. Enforceable vs. judgement

**Enforceable — a gate can fail on it, with a named mechanism:**

| Practice | Mechanism | Where it lives today |
|---|---|---|
| Unused files, exports, types, enum/class members, dependencies | `fallow audit --gate new-only` + `--dead-code-baseline` | `fallow-audit` / `fallow-audit-npm`, gate `fallow-audit`, `floor: fallow-dead-code` |
| Unresolved imports, unlisted dependencies | `.fallowrc.json` `rules` set to `error` | `templates/fallow-audit/.fallowrc.json` |
| Complexity (cyclomatic, cognitive, CRAP) | `fallow health --baseline` | `fallow-audit` / `fallow-audit-npm`, gate `fallow-health`, `floor: fallow-health` |
| Complexity and size caps in-file | oxlint `complexity`/`max-*` rules | `oxlint-anti-slop` / `oxlint-anti-slop-npm`, gate `lint`, `floor: lint` |
| Unreachable statements | `allowUnreachableCode: false` | `tsconfig-strict` / `tsconfig-strict-npm`, gate `typecheck` — **not currently set** |
| Unused locals and parameters | `noUnusedLocals`, `noUnusedParameters` | same — **not currently set** |
| Unused vars and imports in-file | oxlint `no-unused-vars` | `oxlint-anti-slop` — **not currently enabled** |
| Stale suppressions | `stale-suppressions: "error"` | `templates/fallow-audit/.fallowrc.json` — currently default `warn` |
| Suppression without a reason | `require-suppression-reason` | same — opt-in, default `off` |
| Baseline staleness | `--fail-on-stale-baseline` | `fallow-audit` gate script — **not currently passed** |
| Baseline growth | `--fail-on-baseline-growth --baseline-base <ref>` | same — **not currently passed** |
| Parse errors | `failOnParseError` / `--fail-on-parse-error` | same — default `false` |
| Empty analysis | `fail-on-empty-analysis` (Action input) | `ci-workflow` / `ci-workflow-npm` — **not currently set** |

**Judgement — no gate can decide it, and a gate that pretends to will be wrong:**

- **Is this export public API?** fallow cannot see external consumers, and says so: "Library
  public API: External users import these exports, and fallow cannot see those users"
  ([explanations/dead-code](https://fallow.tools/docs/explanations/dead-code/)). The type-aware
  pass repeats the warning: "Evidence that the checker can see does not prove that a published API
  has no external consumers"
  ([analysis/type-aware](https://fallow.tools/docs/analysis/type-aware/)).
- **Is this complex function intentional?** A parser, a state machine, and a generated file all
  score high and should not be refactored. The tool's own answer is a documented override with a
  `reason`, not a rule change: "a higher global `health.maxCyclomatic` to hide a few hotspots
  (acceptable only when the new threshold is a considered project standard with a written
  justification)" ([adoption#5](https://fallow.tools/docs/adoption/)).
- **Is this finding worth fixing or worth baselining?** The tool gives the order and the keep-list
  (§4) but not the decision. "If you cannot explain an exception in one sentence, you probably use
  the wrong mechanism" (ibid.).
- **Is this clone worth extracting?** "Premature abstraction is worse than duplication. If the
  duplicated code does not change and does not cause bugs, leave it. Extract clones that are both
  **large** and **in active changing files**"
  ([explanations/duplication](https://fallow.tools/docs/explanations/duplication/)).
- **Is this a real finding at all?** The documented false-positive classes are all judgement:
  DI-wired class members ("In a project that uses DI a lot, disable `unused-class-members`"),
  library consumer types ("noisy but correct"), Svelte `export let` prop ambiguity ("There is no
  configuration workaround. Review Svelte component exports manually"), and hidden directories
  ([analysis/limitations](https://fallow.tools/docs/analysis/limitations/)).

## Routing

Each practice from §1–§5, routed to the mechanism the library can actually express.

### Enforceable — existing recipe, no change needed

- **Unused files / exports / types / enum members / class members / dependencies** →
  `fallow-audit` (bun) and `fallow-audit-npm` (npm/pnpm). Gate `fallow-audit`, `floor:
  fallow-dead-code`. Already correct: `--gate new-only` plus the committed
  `.fallow-dead-code-baseline.json`, and the gate must be read from `verdict`/exit code, never
  from `attribution.*_introduced` or `summary.*`.
- **Unresolved imports and unlisted dependencies** → `fallow-audit` / `fallow-audit-npm`, via
  `templates/fallow-audit/.fallowrc.json`, which already sets both to `error`. These are the two
  categories fallow calls "correctness issues that can cause runtime failures", so they belong at
  `error` and not in a baseline.
- **Complexity (cyclomatic, cognitive, CRAP)** → `fallow-audit` / `fallow-audit-npm`, gate
  `fallow-health`, `floor: fallow-health`. Already correct: `fallow:ratchet` runs
  `fallow health --coverage … --baseline .fallow-health-baseline.json`, and the recipe already
  documents that `--min-score` MUST NOT be combined with `--baseline`.
- **Complexity and size caps in-file** → `oxlint-anti-slop` / `oxlint-anti-slop-npm`, gate `lint`,
  `floor: lint`. Already correct, including the test-file `overrides` that exempt `max-lines` and
  `max-statements`.

### Enforceable — existing recipe, needs a template change

- **Unreachable statements** → `tsconfig-strict` / `tsconfig-strict-npm`, gate `typecheck`. Add
  `"allowUnreachableCode": false` to `templates/tsconfig-strict/tsconfig.json`. This is the one
  dead-code class that is safe as a wall: the compiler's scope is "provably unreachable due to the
  use of JavaScript syntax", so it cannot fire on a type-analysis guess. Note the floor is a
  *count* (`gates.typecheck.global`), so a repo with pre-existing unreachable code is baselined,
  not blocked.
- **Unused locals and parameters** → `tsconfig-strict` / `tsconfig-strict-npm`, gate `typecheck`.
  Add `"noUnusedLocals": true` and `"noUnusedParameters": true` to the same template. The
  `_`-prefix exemption is built into the compiler, so the escape hatch already exists and needs no
  library support. This is the cheapest real coverage the library is missing.
- **Unused vars and imports in-file** → `oxlint-anti-slop` / `oxlint-anti-slop-npm`, gate `lint`.
  Add `"no-unused-vars": "error"` to `templates/oxlint-anti-slop/oxlint.config.ts`. The rule's own
  documented blind spots (`.d.ts`, `.astro`, `.svelte`, `.vue`) mean it must not be the only
  in-file check, which is why it pairs with the two tsconfig options above rather than replacing
  them.
- **Stale suppressions** → `fallow-audit` / `fallow-audit-npm`. Set `"stale-suppressions":
  "error"` in `templates/fallow-audit/.fallowrc.json`. Without this, a repo that baselines
  accumulates `@expected-unused` tags and `fallow-ignore` comments that no longer suppress
  anything, and the baseline hides the fact.
- **Suppression without a reason** → same file. Set `"require-suppression-reason": "warn"` (or
  `"error"`). This is what makes the "keep" mechanisms auditable: a `@public` tag needs no reason,
  but a `fallow-ignore-next-line` does.
- **Parse errors** → `fallow-audit` / `fallow-audit-npm`. Set `"failOnParseError": true` in
  `.fallowrc.json`, and set `"minimumVersion"` in the same change (the key is unknown to older
  binaries, which exit 2). Caveat to state in the recipe body: in `audit` the gate "checks every
  file that the audit parsed, not only the changed files", so a pre-existing unparseable file
  fails every audit.

### Enforceable — needs a new gate or template

- **Baseline staleness** → `fallow-audit` / `fallow-audit-npm`. The `fallow:audit` script in
  `templates/fallow-audit/package.json` does not pass `--fail-on-stale-baseline`, and it cannot
  usefully: `audit` never runs that gate. The correct home is the **`fallow:ratchet`** script
  (which runs `fallow health --baseline` over the whole project) and a new whole-project
  dead-code check. Concretely: add `--fail-on-stale-baseline` to `fallow:ratchet`, and add a
  `fallow:dead-code` script that runs `fallow dead-code --baseline .fallow-dead-code-baseline.json
  --fail-on-stale-baseline` over the whole project. This is a new gate entry (`id:
  fallow-dead-code-staleness`) or a new recipe; it cannot ride the existing `fallow-audit` gate,
  because that gate is change-scoped by construction.
- **Baseline growth** → same place. `--fail-on-baseline-growth` *does* run in `audit`, so it can
  ride the existing `fallow-audit` gate: add `--fail-on-baseline-growth` to the `fallow:audit`
  script, and require `--baseline-base` (the gate exits 2 when the default base resolves to
  `HEAD`, and exits 2 in a shallow clone). This is the mechanism that makes the committed baseline
  shrink-only, and it is the one that stops "add the finding and re-save the baseline in the same
  commit".
- **Empty analysis** → `ci-workflow` / `ci-workflow-npm`. `fail-on-empty-analysis` is a GitHub
  Action input, not a CLI flag, so the change is in the workflow template: set
  `fail-on-empty-analysis: true` on the fallow step. Without it, a run that analyzed nothing
  reports zero findings and passes, which is indistinguishable from a clean project.
- **A floor that cannot be read must fail closed** → already stated in `library/RECIPE-CONTRACT.md`
  for the unified baseline. The fallow floors were the gap: `.fallow-health-baseline.json` and
  `.fallow-dead-code-baseline.json` are read by `fallow:ratchet` and `fallow:audit`, and a
  malformed file makes fallow exit 2 (which fails the gate) — but a *missing* file silently
  degraded to `--report-only` in `fallow:ratchet`. **Resolved**
  ([#201](https://github.com/Gott50/code-quality-skills/issues/201)), superseding this note's
  earlier recommendation to keep report-only: a missing fallow floor is the greenfield wall, not a
  pass. `fallow:ratchet` drops `--report-only` and gates at zero error-severity findings, printing
  the mode and the `fallow:raise` command on stderr; `fallow:audit` was already fail-closed — its
  `new-only` gate stays active with no baseline, so it fails on the findings the changeset
  introduces, with no grandfathers.

### Judgement — `library/practices/<id>.md` agent instruction

No gate can decide these, and a gate that tries will be wrong in a way the repo cannot see. They
belong in a new `library/practices/` directory (which does not exist yet) as agent instruction,
referenced from the `agent-guidance` recipe's `docs/code-quality.md`.

- **`library/practices/dead-code-triage.md`** — the fix order (correctness first: unresolved
  imports, unlisted deps, then unused files, then unused deps, then unused exports, then the
  member-level classes), the keep-list (public API, convention-based exports, shared type
  packages), and the mechanism ladder (`@public` → `publicPackages` → `entry` → `ignoreExports` →
  `@expected-unused` → inline suppression, in that order). Must state the two rules that make it
  auditable: `@expected-unused` is staleness-checked and visibility tags are not; and "Do not
  suppress an issue that repeats across the codebase."
- **`library/practices/complexity-triage.md`** — the threshold-vs-rule distinction (lowering a
  threshold reports more, it does not fail more), the documented false-positive classes (generated
  files, test suites, config files), and the rule that a known-legacy function gets a
  `thresholdOverrides` entry with a `reason`, never a suppression comment. Must state that a
  global threshold raise is acceptable "only when the new threshold is a considered project
  standard with a written justification".
- **`library/practices/baseline-vs-fix.md`** — when a finding is worth fixing and when it is worth
  baselining, the two rollout strategies and the warn-forever risk, the regeneration cadence
  ("quarterly, or per release, not per merge"), and the rule that a baseline is a ratchet and not
  a wall. Must state that `--raise` merges and the floor never falls, so a repo below its floor
  stays red and the fix is to fix the code, not to lower the floor.
- **`library/practices/verify-before-delete.md`** — `--trace` before acting on any dead-code
  finding, `--type-aware` when the decision depends on exact symbol identity,
  `--type-aware-require complete` when partial evidence must fail, and the `reachability_caveats`
  rule that an incomplete analysis blocks auto-fix. Must state that `fallow fix` does not delete
  files and removes a class method only with complete type-aware evidence.
