---
topic: best-practices-coverage
question: >-
  The team's reference for "what good looks like" is a 72-section, stack-agnostic
  best-practices outline. Which of its sections does this library already cover,
  which should it cover and does not, and which are outside the library's remit
  entirely — so that "what of this should go into the library?" is answered once
  instead of re-derived, and a decided no is distinguishable from an oversight?
verdict: >-
  Of the outline's 72 sections, 10 are already covered by a recipe or a practice,
  and roughly 45 are outside the library's remit — runtime architecture, ops,
  data, and org process, which a repo-local quality gate cannot fail on. The
  remaining sections are real, user-visible gaps, and they close with 10 new
  recipes, 2 modifications to existing recipes, and 16 practices. The line the
  triage draws is the same one the library's own contract draws: a practice is
  gate-able when a command in the repo can exit non-zero on it, and it is
  judgement when only prose can carry it. Everything the outline names that is
  neither a gate nor a rule nor a piece of agent-facing judgement is recorded
  here as deliberately out of remit, with the reason — branch coverage first
  among them.
sources:
  - https://github.com/Gott50/any-factory/blob/main/docs/research/software-development-best-practices.md
  - https://github.com/gitleaks/gitleaks
  - https://google.github.io/osv-scanner/
  - https://osv.dev/
  - https://docs.renovatebot.com/
  - https://semgrep.dev/docs/
  - https://github.com/sverweij/dependency-cruiser
  - https://www.npmjs.com/package/license-checker
  - https://github.com/anchore/syft
  - https://cyclonedx.org/
  - https://spdx.dev/
  - https://commitlint.js.org/
  - https://www.conventionalcommits.org/en/v1.0.0/
  - https://github.com/googleapis/release-please
  - https://docs.npmjs.com/cli/v11/commands/npm-audit
  - https://owasp.org/www-project-dependency-check/
  - https://github.com/ossf/scorecard
  - library/RECIPE-CONTRACT.md
  - research/coverage.md
  - research/formatting.md
  - research/ci-hooks.md
  - research/testing.md
  - research/lint-typecheck.md
  - research/dead-code-complexity.md
  - research/mutation.md
  - research/agent-conventions.md
---

# Best-practices coverage: what the library gates, what it leaves, and what it refuses

The outline is a 72-section, stack-agnostic catalogue
([software-development-best-practices.md](https://github.com/Gott50/any-factory/blob/main/docs/research/software-development-best-practices.md)).
The library is a set of recipes that wire gates into a TypeScript repo, plus practices that
carry the judgement no gate can fail on. This note is the routing between the two: every
outline section, and where it lands.

The routing rule is the library's own contract rule, applied section by section
([`library/RECIPE-CONTRACT.md`](../library/RECIPE-CONTRACT.md)):

- **A recipe** when a command the library installs can exit non-zero on the practice — a
  formatter's zero-diff check, a lint diagnostic count, a coverage floor, an audit's verdict.
- **A practice** when the practice is real and recurring but no command can decide it — the
  test that is worth having, the name that carries meaning, the comment that says *why*.
- **Neither** when the practice is a property of the running system or the organisation, not
  of the repository: an API's shape, a cache's eviction policy, a team's incident process. A
  repo-local gate cannot fail on these, and a recipe that pretended to would be wrong in a way
  the repo cannot see.

That third bucket is the bulk of the outline, and naming it is half the value of this note.
The outline is stack-agnostic and covers the whole of software delivery; the library is a
TypeScript repo's quality gate. The overlap is real but bounded.

## What is already covered

Ten sections map onto recipes and practices that exist today, and this note routes them
without changing anything:

| Outline section | Covered by |
|---|---|
| §4 Code Formatting | `biome-assist` / `biome-assist-npm`, `eslint-prettier`, the `format-check` gate |
| §5 Typing & Static Analysis | `tsconfig-strict` / `-npm` (the `typecheck` gate), `oxlint-type-aware` |
| §6 Linting & Static Analysis | `oxlint-anti-slop` / `-npm` (the `lint` gate) |
| §7 Testing | `bun-test-coverage` / `vitest-coverage`, `stryker-mutation` / `-vitest`, six practices |
| §11 Git & Version Control | `repo-hygiene`, the hook blocks in every recipe |
| §12 CI/CD Pipeline Design | `ci-workflow` / `-npm`, `ci-drift` |
| §13 Code Quality Metrics | the coverage, mutation, lint and fallow gates, `baseline-vs-fix` |
| §15 Documentation | `agent-guidance`, `agents-md-budget`, `context-pointer-wording` |
| §45 Developer Experience | `repo-hygiene`, the pre-commit hook blocks |
| §48 Technical Debt Management | the lint/typecheck count floors, `baseline-vs-fix`, `lint-debt` |

The "already covered" half of the routing is grounded in the eight research notes that
precede this one; this note does not re-derive their verdicts, it records the mapping.

## What the gaps are

The outline names five things a repo-local gate can hold that the library did not:

**The trust boundaries.** Nothing failed on a committed credential, nothing failed on a
dependency advisory, and nothing failed on an assertion over parsed external data. The
outline names the first two in its own maturity list — secrets scanning in CI, dependency
vulnerability scanning — and the third is §5's "runtime type validation vs. static analysis"
made mechanical. A secret scan belongs in `pre-commit` as well as CI: a hook is a
convenience and every hook is bypassable ([git-scm.com/docs/githooks](https://git-scm.com/docs/githooks),
[`research/ci-hooks.md`](./ci-hooks.md)), but a credential caught before it is committed
never has to be rotated. The scan and the audit are the two gates the outline's own
checklist names, so they are phase 1.

**A Jest repo gets no coverage gate at all.** `vitest-coverage` declares
`conflicts.tools: [jest]`, so the recipe is reported as a collision and nothing replaces it;
the same holds for the mutation gate. That is a gap with a known shape and a known fix, and
it is blocked only on a fixture: no fixture declares `jest`, and `pnpm-workspace` is
vitest-only, so `{ dep: jest }` is false there and the Vitest recipe selects instead. The
unblocking step is a fixture, not a seam — see *Out of scope* below.

**Nothing gated the release process.** Commit-message shape, the changelog, the version. The
outline's §14 names the tools directly — `commitlint`, `release-please`, `Changesets` — and
the conventional-commits prefixes are the versioning signal they parse
([conventionalcommits.org](https://www.conventionalcommits.org/en/v1.0.0/),
[commitlint.js.org](https://commitlint.js.org/), [release-please](https://github.com/googleapis/release-please)).

**Nothing gated dependency shape or licenses.** Cycles and deep imports into another
package's internals (§34's barrel/import-path rules, §1's namespace layouts) are a graph
question a tool can answer ([dependency-cruiser](https://github.com/sverweij/dependency-cruiser)).
A dependency whose license is outside an allowlist is a wall plus an SBOM
([license-checker](https://www.npmjs.com/package/license-checker),
[Syft](https://github.com/anchore/syft), [CycloneDX](https://cyclonedx.org/), [SPDX](https://spdx.dev/)).

**The judgement half of a dozen practices reaches no agent.** Flaky-test triage, snapshot
review, test isolation, error taxonomy, structured logging, config validation, module
design, naming, comments, reviewing AI-generated code — each is real, each recurs, and none
has a command that decides it. The outline states them as guidance, which is what a practice
is.

## What closes the gaps

Ten new recipes, two modifications to existing recipes, and sixteen practices. The recipes
are in the *Routing* table below; the practices are these, each with its `enforcedBy`
naming the recipe that carries its machine-checkable half (empty where none does):

| Practice | Carries | Enforced by |
|---|---|---|
| `flaky-test-triage` | quarantine, root-cause, eliminate — never retry | — |
| `snapshot-review` | never blind-update a snapshot | — |
| `test-isolation` | no order-dependent state | — |
| `property-testing` | when a property beats a table | — |
| `one-canonical-lint-config` | one lint config, not three | the lint recipes |
| `format-only-commits` | never mix a reformat with a logic change | the formatter recipes |
| `decode-at-the-boundary` | where `any` is allowed and where a validator is required | the lint recipes |
| `error-taxonomy` | classify an error before writing a handler | — |
| `structured-logging` | key-value events, never PII | — |
| `config-validation` | validate config at startup; never commit environment-specific values | — |
| `deep-modules` | a simple interface over real functionality | the fallow recipes |
| `define-errors-out-of-existence` | reshape the interface instead of adding a handler | — |
| `naming` | avoid `data`, `info`, `manager` | the lint recipes |
| `comments` | write *why*, not *what* | the lint recipes |
| `ai-generated-code-review` | test it more thoroughly, not less | — |
| `release-discipline` | never release without CI green on the release commit | `release-automation` |

`runtime-validation` is the notable non-recipe. Its gate-able half is the
decode-at-the-boundary lint rule, which belongs to the existing lint recipe; the rest is the
practice. Installing a validator (`zod`, `valibot`) is an **application** dependency, not a
gate, and the library does not install application dependencies
([zod](https://zod.dev/), [valibot](https://valibot.dev/)). `property-testing` is the same
shape: installing `fast-check` is a dependency, and no gate can fail on "you should have
written a property".

## How the CI half is proven

Five of the new recipes wire a gate into CI, and the three seams prove only the local half:
the library check's shell-syntax check covers `.husky/*` only, and a workflow template is
neither parsed by the formatter nor linted
([`library/RECIPE-CONTRACT.md`](../library/RECIPE-CONTRACT.md), `scripts/check-library.mjs`).
A CI half nobody has run is a promise, not a gate. So each CI-wiring recipe ships **its own
workflow file** — never a block merged into `ci.yml`, because attaching would need
`requires: [{ recipe: ci-workflow }]` *or* `{ recipe: ci-workflow-npm }` and the predicate
language has no OR, so one edge under-selects the other package-manager variant — and its
`verify` **parses the generated workflow and asserts its job and step names**, mirroring
`ci-workflow`'s own verify. That is the only seam that can see the CI half.

## The decided no's

These are recorded so they are not re-opened as gaps:

- **Branch coverage.** Neither baseline metric set includes branches — the unified baseline
  records `lines`/`functions` for Bun's lcov and `statements`/`functions` for Vitest's
  Istanbul — and gating it needs a new metric in `gates.coverage` plus a reader in both gate
  scripts, against the V8 remapper's documented false positives and false negatives
  ([ast-v8-to-istanbul#limitations](https://github.com/AriPerkkio/ast-v8-to-istanbul#limitations)).
  This is the reason already recorded in [`research/coverage.md`](./coverage.md); restated
  here so the outline's "prefer branch coverage" line is a decision, not an oversight.
- **A second CI platform** (GitLab, Jenkins, CircleCI, Buildkite). The library is
  GitHub-Actions-only; a second platform is a large surface for a small audience.
- **Alternative hook managers** (`lefthook`, `lint-staged`). A variant of an existing
  mechanism, not a new gate.
- **Duplication gating.** The audit tool reports duplication but cannot gate it in the pinned
  version; it stays advisory ([`research/dead-code-complexity.md`](./dead-code-complexity.md)).
- **Installing application dependencies.** `runtime-validation` and `property-testing` are
  practices for this reason: the library installs gate tooling, not the application's own
  libraries.
- **Anything the outline places in the running system or the organisation** — the ~45
  sections in the *Routing* table below marked out of remit.

## Out of scope until a fixture exists

Four recipes are routed by the table below but not built: `jest-coverage`,
`stryker-mutation-jest` (§7), `a11y` (§28), and `bundle-budget` (§39). No fixture declares
`jest` (`pnpm-workspace` is vitest-only, so `{ dep: jest }` is false there and the Vitest
recipe selects instead), none declares a UI framework, and none produces a bundle for a size
budget to measure. They land when a fixture exists; the unblocking step is a fixture, not a
seam ([`fixtures/README.md`](../fixtures/README.md)). They are not dropped from the routing
— a section whose verdict names one of them is a real gap with a known fix, not an
oversight.

## Routing

Every outline section, in order. "Out of remit" means a repo-local gate cannot fail on it,
with the reason in the third column.

| § | Section | Verdict | Where |
|---|---|---|---|
| 1 | Project Structure & Packaging | Partial | Recipe `dep-graph` (namespace/import-path rules: cycles, deep imports into another package's internals). The rest — layout conventions, monorepo-vs-polyrepo, build backends — is out of remit: a repo-local gate cannot fail on a layout choice. |
| 2 | Dependency Management | Partial | Recipes `dep-audit` (vulnerability scanning over the lockfile, with a committed count floor) and `release-automation` (Renovate config). Pinning strategies, vendoring and registry config are out of remit. |
| 3 | Environment & Toolchain Isolation | Partial | Recipe `repo-hygiene` / `-npm` (the runtime pin, `.bun-version` / `.node-version`). Containerisation and hermetic installs are out of remit. |
| 4 | Code Formatting | Covered | `biome-assist` / `-npm`, `eslint-prettier`, gate `format-check`. Practices `format-on-write-vs-check`, `staged-vs-repo-wide`, `generated-files`, `one-time-sweep`, `hook-auto-stage`, plus the new `format-only-commits`. |
| 5 | Typing & Static Analysis | Partial | `tsconfig-strict` / `-npm` (gate `typecheck`), `oxlint-type-aware`; the new lint rule from the `decode-at-the-boundary` modification; practices `tsconfig-strictness`, `type-assertions`, `any-policy`, `type-aware-linting`, and the new `decode-at-the-boundary`. Runtime validation itself is a practice, not a recipe. |
| 6 | Linting & Static Analysis | Covered | `oxlint-anti-slop` / `-npm` (gate `lint`); practices `lint-severity`, `lint-rule-selection`, `lint-suppressions`, `lint-test-exemptions`, `lint-autofix`, `lint-debt`, plus the new `one-canonical-lint-config`. Security-focused linting is recipe `semgrep`. |
| 7 | Testing | Covered | `bun-test-coverage` / `vitest-coverage`, `stryker-mutation` / `-vitest`; practices `test-behaviour-not-implementation`, `one-reason-per-test`, `test-naming`, `test-fixtures`, `never-failing-tests`, `test-boundary`, plus the new `flaky-test-triage`, `snapshot-review`, `test-isolation`, `property-testing`. Changed-lines coverage is a modification to the two coverage recipes. |
| 8 | Error Handling | Partial | Practices `error-taxonomy` and `define-errors-out-of-existence` (the latter is also §34's). Error types, retry policy and boundaries are application design — out of remit. |
| 9 | Logging & Observability | Partial | Practice `structured-logging`. Metrics, tracing, SLOs and aggregation are out of remit: they are runtime infrastructure, not a repo gate. |
| 10 | Security | Partial | Recipes `secret-scan` (credential detection, pre-commit + CI), `dep-audit` (advisories + supply chain), `semgrep` (pattern-level SAST), `license-check` (license allowlist + SBOM). The rest — auth, CSP/CORS, WAF, zero-trust, threat modelling, data classification — is out of remit. |
| 11 | Git & Version Control | Covered | `repo-hygiene` (ignore entries, hook installer), the `.husky/*` blocks in every recipe; practices `merge-marker-comment-syntax`, `hook-cost-split`, `hook-skippability`, `hook-parallelism`; the new `commit-msg` hook from recipe `release-automation`. |
| 12 | CI/CD Pipeline Design | Covered | `ci-workflow` / `-npm` (gate rows in CI), `ci-drift`; practice `ci-required-check`, updated to name every new workflow file. Deployment strategies, artifact promotion and environment promotion are out of remit. |
| 13 | Code Quality Metrics | Covered | The coverage, mutation, lint, typecheck and fallow gates; practices `baseline-vs-fix`, `complexity-triage`, `coverage-is-not-verification`. Branch coverage is a decided no (see *The decided no's*). Review-time metrics are out of remit. |
| 14 | Versioning & Release | Partial | Recipe `release-automation` (commit-message check, changelog and version derivation) plus practice `release-discipline`. Publishing to a registry and pre-release channels are out of remit. |
| 15 | Documentation | Covered | Recipe `agent-guidance` (`AGENTS.md` + `docs/code-quality.md`); practices `agents-md-budget`, `context-pointer-wording`, `environment-is-a-source-of-truth`, `harness-discovery-paths`, `instruction-no-op-test`. |
| 16 | Performance & Profiling | Out of remit | A property of the running system. A repo-local gate can fail on a bundle budget (§39) but not on a profiler's finding. |
| 17 | Configuration Management | Partial | Practice `config-validation` (validate at startup, never commit environment-specific values). Feature-flag services, dynamic config and 12-factor layering are out of remit. |
| 18 | API Design | Out of remit | An interface's shape is a design decision, not a gate. §34's practices carry the judgement that applies. |
| 19 | Data Access Patterns | Out of remit | Query shape, repository boundaries and transaction design are application architecture. |
| 20 | Caching | Out of remit | Eviction policy and cache-key design are runtime decisions. |
| 21 | Async & Concurrency | Out of remit | The type-aware lint layer catches floating promises and unsafe `any` (`oxlint-type-aware`), but concurrency design is out of remit. |
| 22 | Containerization & Deployment | Out of remit | No recipe writes a Dockerfile or a deployment descriptor. |
| 23 | Authentication & Authorization | Out of remit | Security-critical application logic; a repo-local gate cannot verify a policy. |
| 24 | Event-Driven Architecture & Messaging | Out of remit | Broker topology, delivery semantics and idempotency keys are runtime architecture. |
| 25 | Resilience Patterns | Out of remit | Retry, circuit-breaker and bulkhead policy live in the application, not in a gate. |
| 26 | Service Communication | Out of remit | Protocol and contract choice between services. |
| 27 | Internationalization & Localization | Out of remit | Catalogues and locale formatting are application concerns. |
| 28 | Accessibility | Gap — deferred | Recipe `a11y` (axe-core / Pa11y in CI), blocked on a fixture: no fixture declares a UI framework. |
| 29 | Team Practices & Collaboration | Partial | Recipes `agent-guidance` and `repo-hygiene` carry the repo-legibility half; review process, on-call and rituals are out of remit. |
| 30 | Development Process & Methodology | Out of remit | Sprint cadence, estimation and planning are organisational. |
| 31 | Migration & Upgrades | Out of remit | Application migration strategy. The library's own update path is not the outline's topic. |
| 32 | Plugin & Extension Architecture | Out of remit | Application extensibility design. |
| 33 | Licensing & Legal | Partial | Recipe `license-check` (allowlist wall + SBOM). License *choice*, patent clauses and export control are out of remit. |
| 34 | Software Design Principles | Partial | Practices `deep-modules` and `define-errors-out-of-existence` (the latter shared with §8). Coupling/cohesion, SOLID and design-twice are judgement a gate cannot decide; `fallow`'s complexity gates are the only machine-checkable proxy, and they are already wired. |
| 35 | Naming | Partial | Practice `naming` (avoid `data`, `info`, `manager`). Convention *enforcement* is a lint rule the project chooses (`oxlint` naming rules), not one the library ships. |
| 36 | Code Comments | Partial | Practice `comments` (write *why*, not *what*). The lint layer already bans `// @ts-ignore` without a description and requires a `SAFETY:` comment on every surviving type assertion. |
| 37 | Database Design & Schema | Out of remit | Schema and index design are data-layer decisions. |
| 38 | API Consumption & Client Patterns | Out of remit | Client design and retry policy. The boundary *validation* half is the `decode-at-the-boundary` practice. |
| 39 | Frontend & UI Architecture | Partial | Recipe `bundle-budget` (deferred — no fixture produces a bundle) and `a11y` (§28). Component architecture and rendering strategy are out of remit. |
| 40 | Infrastructure as Code | Out of remit | No recipe writes or validates IaC. |
| 41 | Cost Management & FinOps | Out of remit | Cloud spend is not a repo gate. |
| 42 | Data Engineering & Pipelines | Out of remit | Pipeline design and orchestration. |
| 43 | AI & ML Integration | Partial | Practice `ai-generated-code-review` (test AI-generated code more thoroughly, not less). Model serving, evaluation and prompt-injection defence are out of remit. |
| 44 | Debugging & Troubleshooting | Out of remit | Interactive diagnosis. Flaky-test triage (a §7 practice) is the one adjacent piece the library carries. |
| 45 | Developer Experience | Covered | Recipe `repo-hygiene` / `-npm` (runtime pin, `prepare` hook installer); the pre-commit hook blocks in every recipe; practices `hook-cost-split`, `hook-skippability`. |
| 46 | Database Operations | Out of remit | Backup, migration and failover operations. |
| 47 | Architecture Patterns | Out of remit | System-shape decisions. |
| 48 | Technical Debt Management | Partial | The lint/typecheck count floors and the coverage/mutation/fallow ratchets; practices `baseline-vs-fix`, `lint-debt`, `dead-code-triage`, `complexity-triage`. Debt *backlog* process is out of remit. |
| 49 | Monitoring & Alerting | Out of remit | Runtime telemetry and paging. |
| 50 | Disaster Recovery & Business Continuity | Out of remit | Operational planning. |
| 51 | Site Reliability Engineering (SRE) | Out of remit | Error budgets, SLOs and on-call process. |
| 52 | Networking Fundamentals | Out of remit | Network topology and protocols. |
| 53 | Real-time Communication | Out of remit | WebSocket/SSE transport design. |
| 54 | Search & Indexing | Out of remit | Search infrastructure. |
| 55 | Data Privacy & Privacy Engineering | Out of remit | Compliance and data classification are organisational. The `structured-logging` practice carries the one repo-level rule — never log PII. |
| 56 | Domain-Driven Design | Out of remit | Modelling approach. |
| 57 | Mobile Development | Out of remit | Platform-specific build and release. |
| 58 | Dependency Injection & Inversion of Control | Out of remit | Application wiring. The `no-module-mocking` anti-slop rule is the library's one stance here: inject a real interface instead of mocking a module. |
| 59 | Serialization & Data Formats | Partial | The `decode-at-the-boundary` practice and its lint rule cover the *validation* half. Format choice is out of remit. |
| 60 | CLI & Desktop Application Development | Out of remit | Application surface design. |
| 61 | Background Jobs & Scheduled Tasks | Out of remit | Worker and scheduler design. |
| 62 | Multi-tenancy | Out of remit | Isolation strategy. |
| 63 | Data Migration & Live Data Operations | Out of remit | Operational data change. |
| 64 | Open Source Consumption & Contribution | Partial | Recipe `license-check` (license obligations, automated) and `dep-audit` (dependency health and advisories). Fork management and contribution process are out of remit. |
| 65 | Total Cost of Ownership (TCO) | Out of remit | Cost modelling. |
| 66 | Distributed Systems Fundamentals | Out of remit | Distributed architecture. |
| 67 | WebAssembly (WASM) | Out of remit | A compilation target the library does not build for. |
| 68 | Error Budgets & Reliability Tiers | Out of remit | Reliability policy. |
| 69 | API Rate Limiting & Throttling | Out of remit | Runtime traffic control. |
| 70 | Schema Evolution & Compatibility | Out of remit | Versioned schema strategy. |
| 71 | Local-First & Offline-First Architecture | Out of remit | Sync and conflict-resolution design. |
| 72 | Observability for LLM Systems | Out of remit | LLM tracing and evaluation infrastructure. |
