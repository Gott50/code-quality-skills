---
topic: testing
question: >-
  What distinguishes a test that earns its place from one that is ceremony —
  assertion strength (a test that cannot fail is not a test), testing behaviour
  vs. implementation, one reason to fail per test, naming, fixtures and
  factories, what to do with a test that never fails, and the boundary between
  unit and integration — and which of these can a gate fail on (a lint rule, a
  coverage or mutation floor) versus judgement only an agent instruction can
  carry?
verdict: >-
  Only assertion strength and the never-fails test have a gate that fails on the
  practice itself: the mutation floor (a survived mutant is a test that did not
  fail) and, weakly, the coverage floor (a file no test executes). Coverage is a
  weak proxy for both — a test with no assertion reaches 100% coverage. The
  other five practices are judgement: a lint rule can catch their syntactic
  proxies (assertion presence, assertion count, title shape, module mocking) but
  not the judgement, so they belong in an agent instruction. The unit/integration
  boundary has no gate at all; the terms are not even agreed on.
sources:
  - https://martinfowler.com/bliki/AssertionFreeTesting.html
  - https://martinfowler.com/bliki/TestPyramid.html
  - https://martinfowler.com/bliki/UnitTest.html
  - https://martinfowler.com/articles/2021-test-shapes.html
  - https://martinfowler.com/articles/mocksArentStubs.html
  - https://martinfowler.com/bliki/TestDouble.html
  - https://martinfowler.com/bliki/GivenWhenThen.html
  - https://stryker-mutator.io/docs/
  - https://stryker-mutator.io/docs/stryker-js/configuration/
  - https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/expect-expect.md
  - https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/max-expects.md
  - https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/no-conditional-expect.md
  - https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/no-standalone-expect.md
  - https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/prefer-expect-assertions.md
  - https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/valid-title.md
  - https://vitest.dev/guide/test-context
  - https://vitest.dev/guide/coverage
  - https://vitest.dev/config/coverage
  - https://playwright.dev/docs/test-fixtures
  - https://bun.sh/docs/test
---

# Testing: what earns its place

## Assertion strength — a test that cannot fail is not a test

Fowler's *Assertion Free Testing* is the canonical statement of the failure
mode: a project required a JUnit test for every public method, showed the client
"all the tests and the green bar", and "there weren't any assertions in the JUnit
tests" — which still yields 100% code coverage, "one reason why you have to be
careful on interpreting code coverage data"
([martinfowler.com/bliki/AssertionFreeTesting.html](https://martinfowler.com/bliki/AssertionFreeTesting.html)).
He notes the one thing such a test does buy: some faults surface through
execution alone (a null-pointer exception), so an assertion-free test is not
*entirely* useless — it is just not a test of the behaviour.

Mutation testing is the measurement that closes the gap. Stryker inserts a
mutant into the production code and runs the tests: "If your tests *fail* then
the mutant is *killed*. If your tests passed, the mutant *survived*. The higher
the percentage of mutants killed, the more *effective* your tests are"
([stryker-mutator.io/docs](https://stryker-mutator.io/docs/)). The same page
draws the contrast with coverage directly: "code coverage doesn't tell you
everything about the effectiveness of your tests. Think about it, when was the
last time you saw a test without an assertion, purely to increase the code
coverage?"

The lint-rule form of the same rule is `jest/expect-expect`: "Ensure that there
is at least one `expect` call made in a test" — it "triggers when there is no
call made to `expect` in a test, to prevent users from forgetting to add
assertions"
([expect-expect.md](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/expect-expect.md)).
That catches *presence*; only mutation testing catches *strength* (an assertion
that is present but cannot fail).

## Testing behaviour vs. implementation

Fowler's *Mocks Aren't Stubs* separates **state verification** (assert on the
state of the system under test and its collaborators after exercising it) from
**behaviour verification** (assert the calls the SUT made on a mock). The
mockist style's cost is explicit in the article's own section heading, *Coupling
Tests to Implementations*: a mockist test fails when the interaction changes even
if the observable behaviour did not
([martinfowler.com/articles/mocksArentStubs.html](https://martinfowler.com/articles/mocksArentStubs.html)).
*Unit Test* names the two styles **solitary** (doubles for every collaborator)
and **sociable** (real collaborators, doubles only for awkward ones such as a
remote service), and notes the classicist/mockist split maps onto them
([martinfowler.com/bliki/UnitTest.html](https://martinfowler.com/bliki/UnitTest.html)).

The library already carries one machine-checkable proxy for this: the
`anti-slop/no-module-mocking` rule in `oxlint-anti-slop` bans
`vi.mock`/`vi.doMock`/`vi.unstable_mockModule` and `jest.mock`, with the message
"Replace module mocking with dependency injection through a real interface,
service layer, or faithful test implementation"
(`library/templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-module-mocking.ts`).
That bans the mechanism; whether a given assertion names observable behaviour or
an implementation detail is judgement.

## One reason to fail per test

`jest/max-expects` states the rationale: "As more assertions are made, there is
a possible tendency for the test to be more likely to mix multiple objectives"
(default cap 5)
([max-expects.md](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/max-expects.md)).
Two sibling rules guard the same property from the other side:
`no-conditional-expect` — "if calls to assertion functions like `expect` occur in
conditional code such as a `catch` statement, tests can end up passing but not
actually test anything"
([no-conditional-expect.md](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/no-conditional-expect.md))
— and `no-standalone-expect`, which "aims to eliminate `expect` statements that
will not be executed"
([no-standalone-expect.md](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/no-standalone-expect.md)).
`prefer-expect-assertions` pins the count up front with
`expect.assertions(n)`/`expect.hasAssertions()` as the first statement
([prefer-expect-assertions.md](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/prefer-expect-assertions.md)).

The structural form of "one reason" is the Four-Phase Test / Given-When-Then /
Arrange-Act-Assert: one *when* (the behaviour) and one *then* (the expected
change), with the *given* as preconditions
([martinfowler.com/bliki/GivenWhenThen.html](https://martinfowler.com/bliki/GivenWhenThen.html)).
A cap on assertion *count* is a heuristic proxy for one *reason*; whether several
assertions share one reason is judgement.

## Naming

`jest/valid-title` is the machine-checkable floor: a title must not be empty, must
be a string, must not be prefixed with its block name (`test('test foo')`), must
have no leading or trailing spaces, and must use valid printf specifiers in
`.each` titles; it also offers `disallowedWords` and `mustMatch`/`mustNotMatch`
([valid-title.md](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/valid-title.md)).
That enforces *shape*. Whether the name describes the behaviour is judgement.

## Fixtures and factories

Playwright's fixture docs give the design rationale: fixtures "establish the
environment for each test, giving the test everything it needs and nothing else",
are "isolated between tests", "encapsulate setup and teardown in the same place",
are "reusable between test files", "on-demand" (only the ones a test needs are
set up), "composable", and let you "group tests based on their meaning, instead
of their common setup"
([playwright.dev/docs/test-fixtures](https://playwright.dev/docs/test-fixtures)).
Vitest's `test.extend` is the same mechanism with `onCleanup`, `scope:
'file'|'worker'`, `auto`, and `injected` options
([vitest.dev/guide/test-context](https://vitest.dev/guide/test-context)).

Fowler's *Test Double* fixes the vocabulary a factory or fixture produces:
dummy, fake, stub, spy, mock
([martinfowler.com/bliki/TestDouble.html](https://martinfowler.com/bliki/TestDouble.html)).
A factory builds the SUT's data; a double replaces a collaborator. When a fixture
is worth extracting versus a plain factory function is judgement — there is no
rule that can see it.

## A test that never fails

Three detectors, in increasing strength:

- **Assertion-free** — `jest/expect-expect` (above).
- **Never executed** — the coverage floor: a file at 0% is a file no test
  imports. Vitest's `coverage.include` is what puts an unimported file in the
  denominator at all: "By default Vitest will show only files that were imported
  during test run. To include uncovered files in the report, you'll need to
  configure `coverage.include`"
  ([vitest.dev/guide/coverage](https://vitest.dev/guide/coverage)).
- **Executed but not asserted** — the mutation floor: a survived mutant is a test
  that ran the changed code and did not fail (Stryker, above).

A fourth, subtler case is the test that only fails in a particular order or on a
particular run. Bun's runner exposes both: `--rerun-each` "surfaces flaky or
non-deterministic test failures", and `--randomize` "helps detect tests that
depend on shared state or execution order"
([bun.sh/docs/test](https://bun.sh/docs/test)).

What to *do* with a test that never fails — delete it, strengthen it, or keep it
as a guard for a regression no mutant can express — is judgement.

## The unit/integration boundary

Fowler's *Unit Test* defines the common elements (low-level, written by the
programmer, fast) and then says the *unit* is "a situational thing — the team
decides what makes sense to be a unit", with the solitary/sociable split as the
real distinction ([martinfowler.com/bliki/UnitTest.html](https://martinfowler.com/bliki/UnitTest.html)).
The *Test Pyramid* argues for "many more low-level UnitTests than high level
BroadStackTests", because end-to-end tests are "brittle, expensive to write, and
time consuming to run"
([martinfowler.com/bliki/TestPyramid.html](https://martinfowler.com/bliki/TestPyramid.html)).
*On the Diverse And Fantastical Shapes of Testing* then undercuts the whole
debate: the terms "have always been rather murky", the pyramid-vs-honeycomb
argument is "moot" because each side means something different by "unit test",
and the goal that survives is Justin Searls's: "Nearly zero teams write
expressive tests that establish clear boundaries, run quickly & reliably, and
only fail for useful reasons. Focus on that instead"
([martinfowler.com/articles/2021-test-shapes.html](https://martinfowler.com/articles/2021-test-shapes.html)).

The only machine-checkable surfaces the library has here are the recipe
contract's `{ testFile: true }` predicate (`library/RECIPE-CONTRACT.md`) and the
coverage `include`/`exclude` globs that decide what counts as the unit under
test. A per-test timeout (bun `--timeout`, Vitest `testTimeout`) is a wall, not a
boundary.

## Routing

| Practice | Gate? | Where it goes |
|---|---|---|
| Assertion strength | **Yes** — mutation floor | `stryker-mutation` / `stryker-mutation-vitest`: a survived mutant is a test that did not fail. This is the only gate that measures assertion strength. |
| Assertion presence | **Yes** — lint rule | New rule `anti-slop/require-assertion-in-test` in `oxlint-anti-slop` / `oxlint-anti-slop-npm` (new template under `templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/` + a `rules` entry in `oxlint.config.ts`), modelled on `jest/expect-expect`. |
| Assertion strength, weakly | **Yes** — coverage floor | `bun-test-coverage` / `vitest-coverage`: a file at 0% is a file no test executes. Coverage does **not** prove assertion strength (Fowler, *Assertion Free Testing*), so it is a proxy, not the gate. |
| Behaviour vs. implementation | **Partly** — lint rule | `oxlint-anti-slop` / `oxlint-anti-slop-npm` already ship `anti-slop/no-module-mocking`. The judgement itself is not gate-able. |
| Behaviour vs. implementation | **No** | `library/practices/test-behaviour-not-implementation.md` — assert observable behaviour, not the calls a mock received. |
| One reason to fail per test | **Partly** — lint rules | New rules `anti-slop/max-expects-per-test`, `anti-slop/no-conditional-expect`, `anti-slop/no-standalone-expect` in `oxlint-anti-slop` / `oxlint-anti-slop-npm`, modelled on the `jest/*` rules above. These catch the syntactic proxies (count, conditional, dead `expect`). |
| One reason to fail per test | **No** | `library/practices/one-reason-per-test.md` — one *when*, one *then*; several assertions may share one reason. |
| Naming | **Partly** — lint rule | New rule `anti-slop/valid-test-title` in `oxlint-anti-slop` / `oxlint-anti-slop-npm`, modelled on `jest/valid-title` (non-empty, string, no block-name prefix, no stray spaces). |
| Naming | **No** | `library/practices/test-naming.md` — the name states the behaviour, not the method. |
| Fixtures and factories | **No** | `library/practices/test-fixtures.md` — fixtures encapsulate setup+teardown, are on-demand and composable; a factory builds data, a double replaces a collaborator. |
| A test that never fails | **Yes** — mutation + coverage floors | `stryker-mutation` / `stryker-mutation-vitest` (survived mutant) and `bun-test-coverage` / `vitest-coverage` (0% file). |
| A test that never fails | **No** | `library/practices/never-failing-tests.md` — delete, strengthen, or keep as a regression guard. |
| Unit vs. integration boundary | **No** | `library/practices/test-boundary.md` — the terms are not agreed on; aim for tests that establish clear boundaries, run quickly and reliably, and only fail for useful reasons. The only machine-checkable surfaces are the `{ testFile: true }` predicate and the coverage `include`/`exclude` globs. |

The `library/practices/*.md` files are a new surface: prose instructions the
`agent-guidance` recipe renders into `AGENTS.md` / `docs/code-quality.md`
alongside the gate table, so the judgement half of each practice reaches the
agent that writes the tests. The lint rules are new templates in the existing
`oxlint-anti-slop` / `oxlint-anti-slop-npm` recipes — no new recipe is needed for
any of them.
