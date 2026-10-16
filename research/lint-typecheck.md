---
topic: lint-typecheck
question: >-
  Which rules earn their place in a lint config, and which are noise? Cover error vs. warn,
  autofixable vs. not, type-aware rules, `any` and type-assertion policy, strictness in tsconfig,
  and the cost of a rule that fires on legitimate code. Which are enforceable — the config — and
  which are judgement?
verdict: >-
  A rule earns its place when it is decidable from what the tool can see, and either auto-fixable
  or rare enough that a human acts on every report. Severity is a two-way switch, not a dial:
  `error` fails the build, `warn` does not — so a rule that fires on legitimate code must be
  `warn`, suppressed, or fixed, never left as an `error` the team learns to ignore. Type-aware
  rules buy real safety at roughly build-time cost, and are worth it; syntactic rules are nearly
  free. The library's answer to "a rule that fires on legitimate code" is already the right one:
  a **count floor** (the baseline), not a per-rule severity. What the config can enforce is the
  *mechanism* (which rules run, at what severity, with what exemptions, floored at what count);
  what it cannot enforce is the *judgement* (which rules, which exemptions, when to fix vs.
  suppress vs. lower the floor) — that belongs in an agent instruction.
sources:
  - https://eslint.org/docs/latest/use/configure/rules
  - https://eslint.org/docs/latest/use/command-line-interface
  - https://eslint.org/docs/latest/use/core-concepts
  - https://eslint.org/docs/latest/use/suppressions
  - https://eslint.org/docs/latest/extend/custom-rules
  - https://eslint.org/docs/latest/rules/
  - https://typescript-eslint.io/getting-started/typed-linting/
  - https://typescript-eslint.io/troubleshooting/typed-linting/performance/
  - https://typescript-eslint.io/rules/no-explicit-any/
  - https://typescript-eslint.io/rules/no-unsafe-assignment/
  - https://typescript-eslint.io/rules/no-unsafe-return/
  - https://typescript-eslint.io/rules/consistent-type-assertions/
  - https://typescript-eslint.io/rules/no-unnecessary-type-assertion/
  - https://typescript-eslint.io/rules/no-non-null-assertion/
  - https://typescript-eslint.io/rules/no-unnecessary-condition/
  - https://typescript-eslint.io/blog/avoiding-anys/
  - https://www.typescriptlang.org/tsconfig/strict.html
  - https://www.typescriptlang.org/tsconfig/strictNullChecks.html
  - https://www.typescriptlang.org/tsconfig/noImplicitAny.html
  - https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html
  - https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html
  - https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html
  - https://www.typescriptlang.org/tsconfig/useUnknownInCatchVariables.html
  - https://oxc.rs/docs/guide/usage/linter/config.html
  - https://oxc.rs/docs/guide/usage/linter/cli.html
  - https://oxc.rs/docs/guide/usage/linter/rules.html
  - https://oxc.rs/docs/guide/usage/linter/type-aware.html
  - https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json
---

# Lint and typecheck: which rules earn their place

## 1. Error vs. warn is a two-way switch, not a dial

ESLint defines exactly three severities: `"off"`/`0`, `"warn"`/`1` ("doesn't affect exit code"), and
`"error"`/`2` ("exit code is 1 when triggered"). Rules are "typically set to `"error"` to enforce
compliance … during continuous integration testing, pre-commit checks, and pull request merging
because doing so causes ESLint to exit with a non-zero exit code." `"warn"` is for three cases, and
the third is the one that matters here: "when a rule cannot determine with certainty that a problem
has been found (when a rule might have false positives and need manual review)"
([ESLint: Configure Rules](https://eslint.org/docs/latest/use/configure/rules)).

The consequence is that a warning is *inert* by default: "Normally, if ESLint runs and finds no
errors (only warnings), it exits with a success exit status." Only `--max-warnings N` turns a
warning count into a failure, and `--quiet` goes the other way — it "disable[s] reporting on
warnings and running of rules set to warn"
([ESLint: CLI](https://eslint.org/docs/latest/use/command-line-interface)). oxlint mirrors the
severities (`"off"`/`"allow"`, `"warn"`, `"error"`/`"deny"`) and adds `--deny-warnings` ("Ensure
warnings produce a non-zero exit code") and `--max-warnings INT`
([oxlint: Config](https://oxc.rs/docs/guide/usage/linter/config.html),
[oxlint: CLI](https://oxc.rs/docs/guide/usage/linter/cli.html)).

So the real question is not "error or warn" but "does this rule's report always mean the code is
wrong?" ESLint's own rule taxonomy answers it: `meta.type` is `"problem"` ("code that either will
cause an error or may cause a confusing behavior. Developers should consider this a high priority to
resolve"), `"suggestion"` ("something that could be done in a better way but no errors will occur if
the code isn't changed"), or `"layout"` (whitespace and punctuation)
([ESLint: Custom Rules](https://eslint.org/docs/latest/extend/custom-rules)). oxlint's categories
encode the same split: `correctness` ("Code that is definitely wrong or useless"), `suspicious`
("likely to be wrong or useless"), `pedantic` ("Extra strict rules that may have false positives"),
plus `perf`, `style`, `restriction`, `nursery`; only `correctness` is on by default
([oxlint: Config](https://oxc.rs/docs/guide/usage/linter/config.html)).

**Rule of thumb:** `problem`/`correctness` → `error`; `suggestion`/`pedantic` → `warn` or off. A
`pedantic` rule promoted to `error` is the definition of noise: it fails the build on code that is
not wrong.

## 2. Autofixable vs. not decides whether a rule can be enforced at all

ESLint separates two kinds of remedy. A **fix** "safely correct[s] the violation without changing
application logic" and is applied by `--fix`; a **suggestion** "may change application logic and so
cannot be automatically applied" and "cannot be applied through the ESLint CLI and are only
available through editor integrations"
([ESLint: Core Concepts](https://eslint.org/docs/latest/use/core-concepts)). A rule declares
`meta.fixable` as `"code"` or `"whitespace"` — "mandatory for fixable rules" — and omits it
otherwise ([ESLint: Custom Rules](https://eslint.org/docs/latest/extend/custom-rules)). `--fix-type`
filters fixes by `problem`/`suggestion`/`layout`/`directive`, which is how a project that formats
elsewhere still lets ESLint apply non-layout fixes
([ESLint: CLI](https://eslint.org/docs/latest/use/command-line-interface)).

oxlint draws the same line and adds a danger tier: `--fix` ("Fix as many issues as possible"),
`--fix-suggestions` ("Apply auto-fixable suggestions. May change program behavior"), and
`--fix-dangerously`. Its rule legend marks 🛠️ auto-fix, 💡 suggestion, ⚠️🛠️ dangerous auto-fix, ⚠️💡
dangerous suggestion, 🚧 not yet implemented
([oxlint: CLI](https://oxc.rs/docs/guide/usage/linter/cli.html),
[oxlint: Rules](https://oxc.rs/docs/guide/usage/linter/rules.html)).

The distinction is load-bearing for enforcement. A fixable rule can be enforced at `error` with
almost no cost, because the fix is mechanical and the gate is a zero-diff check. A non-fixable rule
at `error` demands a human edit per report — which is exactly the situation ESLint's bulk
suppressions exist for (see §6). typescript-eslint's `no-explicit-any` is the canonical example of a
rule that is *deliberately* not auto-fixable: "By default, this rule will not provide automatic
ESLint *fixes*: only opt-in *suggestions*. Switching types to `unknown` is safer but is likely to
cause additional type errors." The `fixToUnknown: true` option turns on an auto-fixer, and the docs
warn why it is off by default
([typescript-eslint: no-explicit-any](https://typescript-eslint.io/rules/no-explicit-any/)).

## 3. Type-aware rules: real safety, build-time cost

Some typescript-eslint rules "utilize TypeScript's type checking APIs to provide much deeper
insights into your code. This requires TypeScript to analyze your entire project instead of just the
file being linted. As a result, these rules are slower than traditional lint rules but are much more
powerful." They are enabled by `parserOptions.projectService: true`, and the docs are explicit about
the trade: "By using typed linting in your config, you incur the performance penalty of asking
TypeScript to do a build of your project before ESLint can do its linting. For small projects this
takes a negligible amount of time (a few seconds or less); for large projects, it can take longer."
The recommendation is unambiguous: "**We strongly recommend you do use type-aware linting**"
([typescript-eslint: Typed Linting](https://typescript-eslint.io/getting-started/typed-linting/)).

The cost model is "roughly the same as your build times", and the usual culprits are wide `include`
globs — "if you provide no `include` in your tsconfig, then it is the same as providing the widest
glob" — plus expensive stylistic rules (`@stylistic/indent`, `eslint-plugin-prettier`)
([typescript-eslint: Performance](https://typescript-eslint.io/troubleshooting/typed-linting/performance/)).

oxlint implements the same idea through `tsgolint`: `--type-aware` / `options.typeAware: true`,
covering "59 out of 61 type-aware rules from typescript-eslint", with `--type-check` able to replace
a separate `tsc --noEmit` step. It requires `oxlint-tsgolint` and TypeScript 7.0+, and warns that
"Very large codebases may encounter high memory usage". `--debug timings` reports per-rule cost
([oxlint: Type-Aware](https://oxc.rs/docs/guide/usage/linter/type-aware.html)).

Two consequences for a config:

- **Type-aware rules are not free, but they are the only way to catch a whole class of bug** —
  floating promises, unsafe `any` propagation, unnecessary conditions. A syntactic-only config
  cannot express them.
- **A type-aware rule can depend on a compiler option.** `no-unnecessary-condition` requires
  `strictNullChecks`: "Without `strictNullChecks`, TypeScript essentially erases `undefined` and
  `null` from the types … which essentially makes this rule useless." The rule errors on every file
  whose tsconfig does not set it
  ([typescript-eslint: no-unnecessary-condition](https://typescript-eslint.io/rules/no-unnecessary-condition/)).

## 4. `any` and type-assertion policy

`any` is "a dangerous 'escape hatch' from the type system. Using `any` disables many type checking
rules and is generally best used only as a last resort or when prototyping code." The preferred
alternatives are a concrete `interface`/`type` when the shape is known, and `unknown` when it is
not. Crucially, "TypeScript's `--noImplicitAny` compiler option prevents an implied `any`, but
doesn't prevent `any` from being explicitly used"
([typescript-eslint: no-explicit-any](https://typescript-eslint.io/rules/no-explicit-any/)).
`noImplicitAny` itself only errors "whenever it would have inferred `any`"
([TypeScript: noImplicitAny](https://www.typescriptlang.org/tsconfig/noImplicitAny.html)).

`any` is "infectious": "it can turn the types of values based on it into more `any`s." The
`no-unsafe-*` family flags each way it spreads — `no-unsafe-argument` (passing `any` to a call),
`no-unsafe-assignment` (assigning `any` to a variable/property), `no-unsafe-call` (calling `any`),
`no-unsafe-member-access` (reading a member of `any`), `no-unsafe-return` (returning `any`). All
five require type information
([typescript-eslint: Avoiding `any`s](https://typescript-eslint.io/blog/avoiding-anys/),
[no-unsafe-assignment](https://typescript-eslint.io/rules/no-unsafe-assignment/),
[no-unsafe-return](https://typescript-eslint.io/rules/no-unsafe-return/)). Related helpers:
`no-unsafe-function-type` bans the `Function` type; `use-unknown-in-catch-callback-variable`
enforces `unknown` for Promise-rejection callbacks; `ban-ts-comment` prohibits `@ts-ignore` and
`@ts-nocheck` and requires `@ts-expect-error` to carry an explanatory comment (≥3 chars) — and
because `@ts-expect-error` "will produce a new error if there isn't any existing error for it to
suppress", it self-cleans once the underlying type is fixed
([typescript-eslint: Avoiding `any`s](https://typescript-eslint.io/blog/avoiding-anys/)).
`useUnknownInCatchVariables` moves the `catch` variable from `any` to `unknown` at the compiler
level ([TypeScript: useUnknownInCatchVariables](https://www.typescriptlang.org/tsconfig/useUnknownInCatchVariables.html)).

**Type assertions** are the other escape hatch. `consistent-type-assertions` standardizes `as` vs.
angle-bracket, and its `assertionStyle: 'never'` bans assertions outright. Its
`objectLiteralTypeAssertions: 'never'` option is the interesting one: it prefers `const x: T = {…}`
to `const x = {…} as T` because "The type assertion in the latter case is either unnecessary or will
probably hide an error" — the declaration form fails to compile on a missing required field, while
`const x = {} as { foo: number }` succeeds
([typescript-eslint: consistent-type-assertions](https://typescript-eslint.io/rules/consistent-type-assertions/)).
`no-unnecessary-type-assertion` reports assertions that do not change the type, on the grounds that
"Leaving `as` assertions in the codebase increases visual clutter and harms code readability"
([typescript-eslint: no-unnecessary-type-assertion](https://typescript-eslint.io/rules/no-unnecessary-type-assertion/)).
`no-non-null-assertion` bans `!`, because "Using assertions to tell the type system new information
is often a sign that code is not fully type-safe"
([typescript-eslint: no-non-null-assertion](https://typescript-eslint.io/rules/no-non-null-assertion/)).

The policy that emerges: **ban the assertion, not the syntax.** A blanket `assertionStyle: 'never'`
is a style choice; requiring every surviving assertion to state the invariant it relies on is a
correctness rule, and it is the one the library already ships (see §7).

## 5. Strictness in tsconfig

`strict` "enables a wide range of type checking behavior that results in stronger guarantees of
program correctness. Turning this on is equivalent to enabling all of the *strict mode family*
options." It is also a moving target: "Future versions of TypeScript may introduce additional
stricter checking under this flag, so upgrades of TypeScript might result in new type errors in your
program" ([TypeScript: strict](https://www.typescriptlang.org/tsconfig/strict.html)).

The individual options that matter most for a lint/typecheck gate:

- `strictNullChecks` — when false, "`null` and `undefined` are effectively ignored by the language";
  when true they "have their own distinct types and you'll get a type error if you try to use them
  where a concrete value is expected"
  ([TypeScript: strictNullChecks](https://www.typescriptlang.org/tsconfig/strictNullChecks.html)).
  This is the prerequisite for every nullability-aware lint rule.
- `noUncheckedIndexedAccess` — "will add `undefined` to any un-declared field in the type", so
  `env.NODE_ENV` becomes `string | undefined`
  ([TypeScript: noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)).
  It is the compiler-side fix for the false positives `no-unnecessary-condition` documents (§6).
- `exactOptionalPropertyTypes` — a `?` property means "not in the object" or the declared type, not
  `undefined`; `settings.colorThemeOverride = undefined` becomes an error
  ([TypeScript: exactOptionalPropertyTypes](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)).
- `verbatimModuleSyntax` — "any imports or exports without a `type` modifier are left around.
  Anything that uses the `type` modifier is dropped entirely … what you see is what you get." It
  also refuses to rewrite ES imports to `require`, erroring instead
  ([TypeScript: verbatimModuleSyntax](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html)).

The judgement here is *how far past `strict` to go*. `strict` is the floor everyone agrees on;
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are stricter than `strict` and are
"often unwieldy in real-world usage" (the phrase typescript-eslint uses for the former)
([no-unnecessary-condition](https://typescript-eslint.io/rules/no-unnecessary-condition/)). A config
can enforce whichever set the project chose; it cannot decide the set.

## 6. The cost of a rule that fires on legitimate code

This is the failure mode that kills lint configs: a rule that is *right* most of the time, promoted
to `error`, so the team learns to ignore the gate. The primary sources name the mitigations.

**Severity.** ESLint's own guidance is to use `"warn"` "when a rule cannot determine with certainty
that a problem has been found (when a rule might have false positives and need manual review)"
([ESLint: Configure Rules](https://eslint.org/docs/latest/use/configure/rules)). oxlint's `pedantic`
category is defined as "Extra strict rules that may have false positives"
([oxlint: Config](https://oxc.rs/docs/guide/usage/linter/config.html)).

**Documented false positives are the norm, not the exception.** `no-unnecessary-condition` lists
three: possibly-undefined indexed access (TypeScript "optimistically assumes that indexed access
will always return a value"), values modified inside a function call (a TypeScript narrowing
limitation, microsoft/TypeScript#9998), and object types (primitives are assignable to object types,
so `if (x)` on an object-typed parameter can be meaningful). Its remedy is a disable comment, or
`noUncheckedIndexedAccess` ([no-unnecessary-condition](https://typescript-eslint.io/rules/no-unnecessary-condition/)).
`no-non-null-assertion` "might create many false reports" while a project is transitioning to
`strictNullChecks` ([no-non-null-assertion](https://typescript-eslint.io/rules/no-non-null-assertion/)).
The `no-unsafe-*` rules are hard to turn on at all in a codebase with existing `any`s: "It may be
easier to skip the `no-unsafe-*` rules pending increasing type safety in unsafe areas of your
project" ([no-unsafe-assignment](https://typescript-eslint.io/rules/no-unsafe-assignment/)).

**Suppression is a first-class mechanism, not a smell.** ESLint's bulk suppressions exist precisely
for "Enabling a new lint rule as `"error"` … when the codebase has many violations and the rule
isn't auto-fixable": `--suppress-all` (recommended with `--fix` "so that you don't suppress
violations that can be auto-fixed") records existing violations in a committed
`eslint-suppressions.json`, "the rule will be enforced for new code, the existing violations will
not be reported." Unused suppressions then *fail* the run, and `--prune-suppressions` removes them
([ESLint: Bulk Suppressions](https://eslint.org/docs/latest/use/suppressions)).

**Suppression hygiene is enforceable.** ESLint's `reportUnusedDisableDirectives` /
`reportUnusedInlineConfigs` settings report disable comments that no longer suppress anything
([ESLint: Configure Rules](https://eslint.org/docs/latest/use/configure/rules)); oxlint has
`--report-unused-disable-directives` ([oxlint: CLI](https://oxc.rs/docs/guide/usage/linter/cli.html)).
ESLint's guidance on inline disables is to "restrict" them, "Provide a comment explaining the
reason", and "prefer using ESLint configuration files over disable comments"
([ESLint: Configure Rules](https://eslint.org/docs/latest/use/configure/rules)).

**The library's own answer is a count floor.** `scripts/lint-gate.mjs` runs oxlint with
`--format json`, counts the diagnostics, and fails when the count exceeds `gates.lint.global` from
`.code-quality-baseline.json`; with no baseline the floor is 0, "the greenfield wall — so a repo that
never raised one is gated exactly as before: any diagnostic fails"
([`library/templates/oxlint-anti-slop/scripts/lint-gate.mjs`](../library/templates/oxlint-anti-slop/scripts/lint-gate.mjs)).
The recipe contract states the semantics: for `lint` and `typecheck`, "one global count: the current
count must not exceed the recorded count"
([`library/RECIPE-CONTRACT.md`](../library/RECIPE-CONTRACT.md)). This is the same idea as ESLint's
bulk suppressions — freeze the existing debt, fail on new — expressed as a single number rather than
a per-violation file.

## 7. What the library can already express

Grounding the above in the recipes that exist:

- **`oxlint-anti-slop` / `oxlint-anti-slop-npm`** ship a config that turns on 15 vendored anti-slop
  rules plus size/complexity caps (`max-lines: 400`, `max-lines-per-function: 60`,
  `max-statements: 20`, `complexity: 10`), all at `"error"`, and exempt test files from the line and
  statement caps through `overrides` because "they are assertion-heavy, and the caps force
  coverage-degrading condensation"
  ([`library/templates/oxlint-anti-slop/oxlint.config.ts`](../library/templates/oxlint-anti-slop/oxlint.config.ts),
  [`library/recipes/oxlint-anti-slop.md`](../library/recipes/oxlint-anti-slop.md)). The vendored
  rules are **syntactic** — they import only `@oxlint/plugins` and their own siblings, and the
  config does not set `options.typeAware`.
- **`require-safety-comment-for-type-assertion`** is the library's type-assertion policy in code:
  every non-`const` `as`/angle-bracket assertion must carry a nearby `SAFETY:` comment stating the
  invariant TypeScript cannot express
  ([`library/templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/require-safety-comment-for-type-assertion.ts`](../library/templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/require-safety-comment-for-type-assertion.ts)).
  It is the "ban the assertion, not the syntax" policy from §4, made mechanical.
- **`tsconfig-strict` / `tsconfig-strict-npm`** merge the proven option set (`strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
  `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `moduleDetection: force`,
  `moduleResolution: bundler`, `allowImportingTsExtensions`, `noEmit`, `skipLibCheck`, ES2022
  target/lib) and wire `tsc --noEmit` as the `typecheck` gate, floored by the baseline
  ([`library/recipes/tsconfig-strict.md`](../library/recipes/tsconfig-strict.md),
  [`library/templates/tsconfig-strict/tsconfig.json`](../library/templates/tsconfig-strict/tsconfig.json)).
- **`biome-assist`** runs Biome with `linter.enabled: false` "because oxlint owns linting", and
  `eslint-prettier` writes no config at all — it only turns a project's existing ESLint + Prettier
  into gates, because "a `create` of a config the project owns would be permanent drift from the
  first run"
  ([`library/recipes/biome-assist.md`](../library/recipes/biome-assist.md),
  [`library/recipes/eslint-prettier.md`](../library/recipes/eslint-prettier.md)).

What the library **cannot** currently express, and why it matters for routing:

- No `when` predicate reads a lint config or a tsconfig option. The predicate set is `{ file }`,
  `{ dep }`, `{ script }`, `{ testFile }`, `{ recipe }`
  ([`library/RECIPE-CONTRACT.md`](../library/RECIPE-CONTRACT.md)). So a recipe cannot say "apply
  only if `strictNullChecks` is on" — which a type-aware rule needs (§3).
- No recipe enables type-aware linting. `oxlint-anti-slop`'s config has no `options.typeAware`, and
  the `no-unsafe-*` family is absent.
- The lint gate counts diagnostics; it does not pass `--report-unused-disable-directives`, and the
  config sets no `warn` severity — every rule is `error`, with the count floor doing the work a
  severity split would otherwise do.

## Routing

For each practice: can a gate fail on it? If yes, the recipe (or the new recipe/template) that
enforces it. If no, the `library/practices/<id>.md` agent instruction it needs. Every
`typescript/*` rule id named below is present in oxlint's configuration schema
([oxlint schema](https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json)).

| Practice | Enforceable? | Where it lives |
|---|---|---|
| **Severity split: `problem`/`correctness` → `error`, `suggestion`/`pedantic` → `warn` or off** | Partly. The *mechanism* is config; the *choice* is judgement. | Mechanism: `oxlint-anti-slop` / `oxlint-anti-slop-npm` (`oxlint.config.ts` severities) + the `lint` gate. Judgement: `library/practices/lint-severity.md` — the library currently sets every rule to `error` and relies on the count floor; the practice states when a rule should instead be `warn`. |
| **A fixable rule must be auto-fixed, not reported** | Yes. | `biome-assist` / `biome-assist-npm` already do this for formatting (`format-check` is a zero-diff gate after the `--write` sweep). For lint, add a `--fix` command to `oxlint-anti-slop`'s `commands` (oxlint `--fix` / `--fix-suggestions` / `--fix-dangerously`), then let the `lint` gate count the remainder. The *policy* of which fix tier is safe to apply unattended is `library/practices/lint-autofix.md`. |
| **Type-aware rules (floating promises, unsafe `any`, unnecessary conditions)** | Yes, but not yet. | New recipe `oxlint-type-aware` (+ `oxlint-type-aware-npm`): add `oxlint-tsgolint`, set `options.typeAware: true`, enable the `typescript/*` rules. It needs a new `when` predicate `{ tsconfig: <option> }` (e.g. `strictNullChecks`) so it does not apply to a project whose tsconfig makes the rules useless. The *decision* to pay build-time cost is `library/practices/type-aware-linting.md`. |
| **`any` policy: ban explicit `any`, prefer `unknown`, ban `Function`** | Yes. | `oxlint-anti-slop` / `oxlint-anti-slop-npm`: add `typescript/no-explicit-any` (syntactic — no type info needed) and `typescript/no-unsafe-function-type` to `oxlint.config.ts`. The `no-unsafe-*` family is type-aware → the new `oxlint-type-aware` recipe. The *boundary* policy ("`any` is allowed only at a decoded I/O boundary") is `library/practices/any-policy.md`. |
| **Type-assertion policy: every assertion states its invariant** | Yes. | Already enforced by `oxlint-anti-slop`'s `require-safety-comment-for-type-assertion`, `no-chained-type-assertions`, `no-widen-then-assert`. The *judgement* of when an assertion is legitimate (vs. a missing decode) is `library/practices/type-assertions.md`. |
| **`@ts-ignore` / `@ts-nocheck` banned; `@ts-expect-error` needs a description** | Yes. | `oxlint-anti-slop` / `oxlint-anti-slop-npm`: add `typescript/ban-ts-comment` to `oxlint.config.ts`. No new recipe needed. |
| **tsconfig strictness (`strict` + the extra options)** | Yes. | `tsconfig-strict` / `tsconfig-strict-npm` (the `typecheck` gate). The *choice* of how far past `strict` to go (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) is `library/practices/tsconfig-strictness.md`; note `strict` is a moving target across TS versions. |
| **A rule that fires on legitimate code must be `warn`, suppressed, or fixed — never an ignored `error`** | Yes, as a count floor. | The `lint` and `typecheck` gates with `floor: lint` / `floor: typecheck` (the baseline). The *policy* of fix vs. suppress vs. lower the floor is `library/practices/lint-debt.md`. |
| **Suppression hygiene: no unused disable directives; every disable carries a reason** | Yes. | `oxlint-anti-slop` / `oxlint-anti-slop-npm`: add `--report-unused-disable-directives` to the `lint` script (`scripts/lint-gate.mjs` invocation) and to the pre-commit block. The *requirement* that a disable comment explain itself is `library/practices/lint-suppressions.md`. |
| **Test files are exempt from size/complexity caps** | Yes. | Already in `oxlint-anti-slop`'s `oxlint.config.ts` `overrides`. The *policy* of which rules to relax in tests (and which never to relax) is `library/practices/lint-test-exemptions.md`. |
| **Type-aware rules require `strictNullChecks`** | Yes, once the predicate exists. | New `when` predicate `{ tsconfig: <option> }` in `library/RECIPE-CONTRACT.md` (bumps `library.json`'s `schemaVersion`), consumed by `oxlint-type-aware`. |
| **Which rules to enable at all, and which to leave off** | No. | `library/practices/lint-rule-selection.md` — the config can run whatever is listed; it cannot decide that a rule is noise for this project. |
| **When to fix a violation vs. suppress it vs. lower the floor** | No. | `library/practices/lint-debt.md` — the baseline records the level; the judgement of whether to spend the effort is human. |
| **Whether to pay the type-aware build-time cost** | No. | `library/practices/type-aware-linting.md` — the recipe can install it; the trade-off is a project decision. |
