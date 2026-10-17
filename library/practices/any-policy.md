---
id: any-policy
title: Confine `any` to the decoded boundary
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/lint-typecheck.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm, oxlint-type-aware, oxlint-type-aware-npm]
---

Confine `any` to the boundary where untrusted input is decoded, and prefer `unknown` everywhere
else.

`any` is an escape hatch that disables type checking for everything it touches, and it is
infectious: a value typed `any` turns the values derived from it into more `any`s. The compiler
option that bans an *implied* `any` does not ban an explicit one, so the explicit `any` is the one a
rule has to catch.

The alternatives are concrete: a `type` or `interface` when the shape is known, `unknown` when it is
not. `unknown` forces the decode to be written down, which is the point — the check that turns
untrusted input into a typed value is the one place the shape is actually established.

So the policy is a boundary, not a ban. `any` is allowed where the boundary is: the adapter that
reads a JSON payload, a third-party callback whose types are wrong. Everywhere else it is a hole in
the type system, and the family of rules that flags each way it spreads is what keeps the hole from
widening.
