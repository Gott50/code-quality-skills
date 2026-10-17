---
id: type-assertions
title: An assertion states the invariant it relies on
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/lint-typecheck.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

State the invariant an assertion relies on, or replace the assertion with a decode.

An assertion is a promise to the compiler that the value is what the code says it is. The compiler
cannot check the promise, so the only thing that makes it safe is the reason it is true — and a
reason that lives only in the author's head is lost at the next refactor.

Banning the syntax is a style choice; requiring the invariant is a correctness rule. An assertion
that carries the invariant it relies on is reviewable: a reader can check the reason, and a change
that invalidates it is visible. An assertion with no reason is indistinguishable from a guess.

The judgement is when an assertion is legitimate at all. An assertion that narrows a value the code
has already checked is fine; an assertion that stands in for a decode — `as` on a payload from
outside the program — is a missing check wearing a type. When the reason cannot be written down, the
assertion is the defect.
