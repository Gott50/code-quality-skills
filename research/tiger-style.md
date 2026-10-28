---
topic: tiger-style
question: >-
  TigerStyle is a 517-line, Zig-first coding-style document. Which of its rules
  does this library already cover, which should it cover and does not, and which
  are outside its remit — so that "what of this should be added into the library?"
  is answered once instead of re-derived, and a decided no is distinguishable from
  an oversight?
verdict: >-
  Of TigerStyle's 57 rules, 8 are already covered by a recipe or practice and 1 is
  aligned with a shipped gate; 2 are real gaps that close as new practices (the
  assertion family, and descriptive commit messages); 10 are extensions of an
  existing practice or recipe (the naming facets, `no-shadow`, `curly`, the
  comment's "say how"); 2 are decided-no (a recursion ban, and typed-scripts-over-shell);
  and the remaining 34 are outside the library's remit — Zig mechanisms, runtime
  architecture, performance design, and org process, which a repo-local TypeScript
  gate cannot fail on. The line is the library's own contract line: a recipe when a
  command can exit non-zero, a practice when the judgement is real and recurring,
  and neither when the rule is a property of the running system or the organisation.
sources:
  - https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md
  - library/RECIPE-CONTRACT.md
  - library/library.json
  - library/templates/oxlint-anti-slop/oxlint.config.ts
  - library/templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-object-parameters.ts
  - library/templates/release-automation/commit-msg.block
  - library/templates/release-automation/commitlint.config.mjs
  - library/templates/release-automation/scripts/commit-msg.sh
  - library/templates/biome-assist/biome.json
  - library/practices/naming.md
  - library/practices/comments.md
  - library/practices/release-discipline.md
  - research/best-practices-coverage.md
  - research/lint-typecheck.md
  - research/testing.md
  - research/ci-hooks.md
  - research/coverage.md
  - research/mutation.md
  - research/dead-code-complexity.md
  - research/formatting.md
  - research/agent-conventions.md
---

# TigerStyle: what of it belongs in the library

TigerStyle is TigerBeetle's 517-line, Zig-first coding-style document
([TIGER_STYLE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md)).
Its design goals are safety, performance and developer experience, in that order, and most of its
rules are stated for a safety-critical, statically-allocated, zero-dependency database written in
Zig. The library is a TypeScript repo's quality gate: recipes that wire a command which can exit
non-zero, and practices that carry the judgement no command can decide
([`library/RECIPE-CONTRACT.md`](../library/RECIPE-CONTRACT.md)).

The scope boundary is the one agreed on the ticket: TigerStyle's **Zig mechanism** is out of scope,
its **language-agnostic principle** is in scope. A rule that meets a shipped gate, practice or
template is recorded as *aligned*, *extension*, *decided-no* or *modification* — never silently
dropped. The routing rule is the library's own contract rule, applied rule by rule: a **recipe**
when a command the library installs can exit non-zero on the practice; a **practice** when the
practice is real and recurring but no command can decide it; **neither** when the practice is a
property of the running system or the organisation, not of the repository.

## What is already covered

Eight rules map onto recipes and practices that exist today, and this note routes them without
changing anything:

- **70 lines per function** — `oxlint-anti-slop` / `oxlint-anti-slop-npm` already gate
  `max-lines-per-function: 60`, stricter than TigerStyle's 70
  ([`oxlint.config.ts`](../library/templates/oxlint-anti-slop/oxlint.config.ts)).
- **Appreciate all compiler warnings at the strictest setting** — `tsconfig-strict` /
  `tsconfig-strict-npm` (the `typecheck` gate) ([`research/lint-typecheck.md`](./lint-typecheck.md)).
- **All errors must be handled** — the practices `error-taxonomy` and
  `define-errors-out-of-existence`, plus the type-aware lint layer (`oxlint-type-aware`) that
  catches floating promises ([`research/best-practices-coverage.md`](./best-practices-coverage.md)).
- **Always motivate, always say why** — the `comments` practice ("say why, not what")
  ([`library/practices/comments.md`](../library/practices/comments.md)).
- **Get the nouns and verbs just right** — the `naming` practice ("a name says what the thing is")
  ([`library/practices/naming.md`](../library/practices/naming.md)).
- **Don't forget to say why (comments)** — the `comments` practice, again.
- **Run `zig fmt`** — `biome-assist` / `biome-assist-npm` and `eslint-prettier` (the `format-check`
  gate) ([`research/formatting.md`](./formatting.md)).
- **Hard limit line lengths to 100 columns** — `biome-assist` sets `lineWidth: 100`, matching
  TigerStyle exactly ([`biome.json`](../library/templates/biome-assist/biome.json)).

One rule is **aligned** with a shipped gate rather than merely covered:

- **Named arguments via the `options: struct` pattern** — `anti-slop/no-object-parameters` bans the
  broad `object` *type*, not options structs. `resolvesToObject` matches only `TSObjectKeyword`, a
  parenthesized type, a union containing one, and a local `type` alias resolving to one; an inline
  `TSTypeLiteral` or a named `interface` is never reported, and the rule's own message says "Accept
  a named owner type"
  ([`no-object-parameters.ts`](../library/templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-object-parameters.ts)).
  The `naming` practice carries the judgement half, and its `enforcedBy` names `oxlint-anti-slop` /
  `oxlint-anti-slop-npm` ([`library/practices/naming.md`](../library/practices/naming.md)).

## The gaps

Two rules are real, recurring judgement that no gate can decide and that the library does not carry:

**The assertion family.** TigerStyle's assertion rules — assert all arguments, return values,
pre/postconditions and invariants; a density of at least two assertions per function; pair
assertions across two code paths; assert the positive *and* the negative space; assert the
relationships of compile-time constants and type sizes; split compound assertions; use a single-line
`if` to assert an implication; use a blatantly-true assertion as documentation; and treat assertions
as a safety net, not a substitute for understanding — have no existing home. The library's only
assertion rule, `anti-slop/require-assertion-in-test`, is test-scoped: it requires at least one
`expect` in every `test`/`it` block and never looks at production code
([`require-assertion-in-test.ts`](../library/templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/require-assertion-in-test.ts)).
No production-code assertion rule exists, and no gate can fail on "this function should have asserted
its precondition". The nearest existing practice, `type-assertions`, is a different thing: it governs
the `as` cast — a promise to the *compiler* — while TigerStyle's family is about runtime `assert()`
calls that check a value the compiler cannot
([`library/practices/type-assertions.md`](../library/practices/type-assertions.md)). This lands as
**one practice**, as agreed on the ticket.

**Descriptive commit messages.** TigerStyle asks for commit messages that inform the reader, noting
that a pull-request description is not stored in the repository and is invisible in `git blame`.
The library's `release-automation` recipe gates the commit-message *header shape*: its
`commitlint.config.mjs` is `extends: ["@commitlint/config-conventional"]` plus
`"header-max-length": [2, "always", 72]` — a type, an optional scope, a subject, and a 72-column
cap — and `release-discipline` carries the release-time judgement
([`commitlint.config.mjs`](../library/templates/release-automation/commitlint.config.mjs),
[`library/practices/release-discipline.md`](../library/practices/release-discipline.md)). Neither
reaches the message *body*, and no gate can decide whether a body is descriptive. This is
**adjacent, not covered**, and lands as a new practice.

Ten rules are facets of a practice or recipe the library already ships, and extend it rather than
minting a near-duplicate:

- **The naming facets.** The `naming` practice carries "a name says what the thing is",
  convention-matching, and contract-not-implementation; it does not carry units-last ordering,
  overloaded names, declaration order, the no-abbreviation rule, or the noun-over-adjective rule
  ([`library/practices/naming.md`](../library/practices/naming.md)). Those are an **extension** of
  `naming`, not new siblings.
- **`no-shadow`.** TigerStyle's "declare variables at the smallest possible scope", "minimize the
  number of variables in scope", and "don't duplicate variables or take aliases to them" are
  partially gate-able: oxlint's `no-shadow` catches the shadowing symptom. It is absent from
  `oxlint.config.ts` ([`oxlint.config.ts`](../library/templates/oxlint-anti-slop/oxlint.config.ts)).
- **`curly`.** TigerStyle's "add braces to the `if` statement unless it fits on a single line" is
  exactly oxlint's `curly` with the `multi-line` option, and it is absent. It is compatible with the
  library's own templates, which use single-line braceless `if`s (e.g.
  `if (!hunk || file === null) continue;` in `templates/vitest-coverage/scripts/changed-lines.mjs`).
- **The comment's "say how".** TigerStyle asks a test to open with a description of its goal and
  methodology. The `comments` practice carries "say why"; "say how" is a facet it does not carry
  ([`library/practices/comments.md`](../library/practices/comments.md)).

## The decided no's

These are recorded so they are not re-opened as gaps:

- **A recursion ban.** TigerStyle's "do not use recursion" is a language-agnostic principle, and a
  `no-recursion` lint rule is absent from `oxlint.config.ts`. It is a decided-no because the
  library's own anti-slop rules recurse — `resolvesToObject` and `parameterAnnotation` in
  `no-object-parameters.ts` both call themselves
  ([`no-object-parameters.ts`](../library/templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/no-object-parameters.ts))
  — so a blanket ban would fail the library's own templates. The general proxy is already wired:
  `complexity`, `max-depth` and `max-nested-callbacks`.
- **Typed scripts over shell.** TigerStyle's "instead of `scripts/*.sh`, write `scripts/*.zig`" is a
  language-agnostic principle, but the library's hook surface is shell by construction. Six
  templates ship `.sh` (`dep-graph`, `license-check`, `release-automation`, `release-automation-npm`,
  `secret-scan`, `semgrep`), and `templates/release-automation/commit-msg.block` is
  `sh scripts/commit-msg.sh "$1" || exit 1` — the wrapper must run before any package manager
  exists, and `commit-msg.sh` is the thing that *invokes* the runtime (`bunx`/`npx`)
  ([`commit-msg.block`](../library/templates/release-automation/commit-msg.block),
  [`commit-msg.sh`](../library/templates/release-automation/scripts/commit-msg.sh)). A practice the
  library's own templates violate is worse than no practice. Note that no practice named
  `typed-scripts-over-shell` exists — it is a candidate, and this is the reason it is not minted.

## What is out of remit

The remaining 34 rules are properties of the running system, the Zig mechanism, or the organisation,
and a repo-local TypeScript gate cannot fail on them. The bulk is TigerStyle's **performance**
section (design-phase thinking, back-of-the-envelope sketches, optimizing the slowest resource first,
control plane vs data plane, batching, CPU predictability, extracting hot loops) — the same bucket
`research/best-practices-coverage.md` routes as out of remit for §16. The rest is Zig mechanism
(explicitly-sized types, static allocation, `*const` arguments, in-place construction, `@divExact`,
`zig fmt`'s 4-space indent, the Zig style guide), runtime architecture (bounded loops and fail-fast,
not reacting directly to external events, functions that run to completion without suspending,
buffer bleeds), design judgement the library does not carry (function shape, splitting compound
conditions, stating invariants positively, explicit call-site options, POCPOU, simpler signatures,
threading singletons, comment punctuation, grouping allocations), and org process (the zero-
dependencies policy, the small standardized toolbox).

## Routing

Every TigerStyle rule, in document order. "Out of remit" means a repo-local gate cannot fail on it,
with the reason in the third column.

| TigerStyle rule | Verdict | Where |
| --- | --- | --- |
| Simple, explicit control flow; do not use recursion | Decided-no | A `no-recursion` rule is absent by design: the library's own anti-slop rules recurse (`resolvesToObject`, `parameterAnnotation` in `no-object-parameters.ts`), so a blanket ban would fail the library's own templates. `complexity` / `max-depth` / `max-nested-callbacks` in `oxlint.config.ts` are the general proxy. |
| Put a limit on everything (bounded loops and queues, fail-fast) | Out of remit | A property of the running system; no repo-local gate can fail on "every loop has a bound". |
| Use explicitly-sized types (`u32`, not `usize`) | Out of remit | Zig mechanism; TypeScript has no sized integer types. |
| Assertions: density ≥2 per function, pair assertions, positive and negative space, compile-time assertions of constants and type sizes, split compound assertions, single-line `if` implication, a blatantly-true assertion as documentation, assertions as a safety net | New practice | `library/practices/assertions.md`. No gate: `require-assertion-in-test` is test-scoped, and no production-code assertion rule exists. |
| All memory statically allocated at startup; no dynamic allocation after init | Out of remit | Zig mechanism / runtime. |
| Declare variables at the smallest possible scope; minimize the number of variables in scope | Extension | Extend `oxlint-anti-slop` / `-npm`: add `no-shadow` to `oxlint.config.ts`. |
| Hard limit of 70 lines per function | Already covered | `oxlint-anti-slop` / `-npm` `max-lines-per-function: 60` (stricter). |
| Function shape (hourglass), centralize control flow, push `if`s up and `for`s down, centralize state manipulation, keep leaf functions pure | Out of remit | Design judgement; `deep-modules` is the design practice the library carries. |
| Appreciate all compiler warnings at the compiler's strictest setting | Already covered | `tsconfig-strict` / `tsconfig-strict-npm` (the `typecheck` gate). |
| Don't do things directly in reaction to external events; run at your own pace | Out of remit | Runtime architecture. |
| Split compound conditions into nested `if`/`else`; split `else if` chains into `else { if { } }` trees | Out of remit | Readability judgement; no gate. |
| State invariants positively (avoid negations) | Out of remit | Readability judgement; no gate. |
| All errors must be handled | Already covered | `error-taxonomy`, `define-errors-out-of-existence`; `oxlint-type-aware` catches floating promises. |
| Always motivate, always say why | Already covered | `comments` (say why, not what). |
| Explicitly pass options to library functions at the call site | Out of remit | Call-site convention; no gate. |
| Think about performance from the outset, in the design phase | Out of remit | A property of the running system. |
| Back-of-the-envelope sketches with respect to the four resources | Out of remit | A property of the running system. |
| Optimize the slowest resources first | Out of remit | A property of the running system. |
| Distinguish the control plane from the data plane | Out of remit | Runtime architecture. |
| Amortize network, disk, memory and CPU costs by batching | Out of remit | A property of the running system. |
| Let the CPU be a sprinter; be predictable | Out of remit | A property of the running system. |
| Be explicit; extract hot loops into stand-alone functions | Out of remit | Performance design; no gate. |
| Get the nouns and verbs just right | Already covered | `naming`. |
| Use `snake_case` for function, variable and file names | Out of remit | Zig convention; TypeScript uses camelCase, and `naming` says match the surrounding convention. |
| Do not abbreviate variable names; use long-form flags | Extension | Extend `naming`: add "don't abbreviate; long-form flags". |
| Use proper capitalization for acronyms | Out of remit | Convention detail; `naming` says match the convention. |
| Follow the Zig style guide | Out of remit | Zig mechanism. |
| Add units or qualifiers to names, and put them last, sorted by descending significance | Extension | Extend `naming`: units-last ordering. |
| Related names with the same number of characters | Out of remit | Aesthetic convention; no gate. |
| Prefix a helper with the calling function's name | Out of remit | Aesthetic convention; no gate. |
| Callbacks go last in the parameter list | Out of remit | Convention detail; no gate. |
| Order matters: `main` first, fields then types then methods; sort alphabetically when in doubt | Extension | Extend `naming`: declaration order. |
| Don't overload names with multiple meanings | Extension | Extend `naming`: overloaded names. |
| Think of how names will be used outside the code (a noun beats an adjective) | Extension | Extend `naming`: noun names compose. |
| Named arguments via the `options: struct` pattern; two `u64` must use an options struct; a nullable argument is named | Aligned | `oxlint-anti-slop` / `-npm` `no-object-parameters` bans the broad `object` type, not options structs — its message says "Accept a named owner type" — and `naming` carries the practice. |
| Thread singletons (allocator, tracer) positionally, most general to most specific | Out of remit | Dependency-injection design. |
| Write descriptive commit messages | New practice | `library/practices/descriptive-commit-messages.md`. Adjacent to `release-discipline` and `release-automation`: commitlint gates the header shape, not the body. |
| Don't forget to say why (comments) | Already covered | `comments`. |
| Don't forget to say how (a test's goal and methodology) | Extension | Extend `comments`: add "say how" for tests. |
| Comments are sentences (space after the slash, capital, full stop) | Out of remit | Punctuation convention; no gate. |
| Don't duplicate variables or take aliases to them | Extension | Extend `oxlint-anti-slop` / `-npm`: add `no-shadow` to `oxlint.config.ts`. |
| Pass a large argument as `*const` to avoid a copy | Out of remit | Zig mechanism; TypeScript has no by-value/by-reference distinction. |
| Construct large structs in-place (out pointer) | Out of remit | Zig mechanism. |
| Calculate or check variables close to where they are used (POCPOU) | Out of remit | Design judgement; no gate. |
| Simpler signatures and return types (`void` > `bool` > `u64` > `?u64` > `!u64`) | Out of remit | Design judgement; no gate. |
| Functions run to completion without suspending | Out of remit | Runtime/concurrency. |
| Guard against buffer bleeds | Out of remit | Memory safety; Zig mechanism. |
| Group resource allocation and deallocation with newlines | Out of remit | Style detail; no gate. |
| `index`/`count`/`size` as distinct types; units in names | Extension | Extend `naming`: units-last ordering. |
| Show intent with division (`@divExact`, `@divFloor`, `div_ceil`) | Out of remit | Zig mechanism. |
| Run `zig fmt` | Already covered | `biome-assist` / `-npm`, `eslint-prettier` (the `format-check` gate). |
| Use 4 spaces of indentation | Out of remit | The library's formatter recipe sets `indentWidth: 2` (Biome's default); the width is a project config choice. |
| Hard limit line lengths to 100 columns | Already covered | `biome-assist` sets `lineWidth: 100`. |
| Add braces to an `if` unless it fits on a single line | Extension | Extend `oxlint-anti-slop` / `-npm`: add `curly: ["error", "multi-line"]`; compatible with the library's own single-line `if`s. |
| Zero dependencies policy | Out of remit | Org/design policy; the library installs gate tooling, not application dependencies. |
| A small standardized toolbox | Out of remit | Org process. |
| Write scripts in Zig, not shell | Decided-no | Collides with the library's six `.sh` templates; the hook surface is shell by construction (`commit-msg.block` is `sh scripts/commit-msg.sh "$1" || exit 1`, and `commit-msg.sh` invokes `bunx`/`npx`). |
