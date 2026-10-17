---
id: type-aware-linting
title: Decide whether to pay for type-aware linting
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/lint-typecheck.md
enforcedBy: [oxlint-type-aware, oxlint-type-aware-npm]
---

Pay the type-aware build-time cost when the project's types are worth checking.

Some rules need the whole project's types, not one file's syntax: a floating promise, an `any` that
spreads through an assignment, a condition that cannot be false. A syntactic-only config cannot
express them at all, so the choice is not "which of these rules" but "do we run a type-aware pass".

The cost is roughly a build: the linter asks the compiler to analyse the project before it lints.
For a small project that is seconds; for a large one it is the build time again, and the usual
culprits are a wide `include` glob and expensive stylistic rules. The pass also depends on the
compiler options it reads — a nullability rule is useless without `strictNullChecks`, and the tool
says so rather than silently passing.

The decision is a project decision, not a config one: the recipe can install the pass, but only the
project can decide that its types are worth the build time. A project that cannot afford it should
say so and keep the syntactic rules, rather than enabling the pass and disabling the rules it exists
for.
