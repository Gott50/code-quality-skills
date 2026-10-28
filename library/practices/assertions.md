---
id: assertions
title: Assert what a function assumes and what it promises
when: { requires: [{ file: package.json }] }
source: research/tiger-style.md
enforcedBy: []
---

Assert what a function assumes on the way in and what it promises on the way out, at the point the
assumption is made and the promise is kept.

The type system proves what it can and leaves the rest as a claim: a value that is non-empty, a
count that is positive, an index inside its array, a state reachable only after initialization. An
assertion is the check the compiler cannot write, and it turns a wrong value that would surface far
away — as a corrupt result, a silent no-op, a crash in an unrelated caller — into a failure at the
line that produced it. That distance is the whole value: the closer the failure sits to its cause,
the cheaper it is to find.

Assert the arguments, the return value, the preconditions and postconditions, and the invariants
that hold across the call. Check the positive space and the negative space — that the valid input is
accepted and the invalid one rejected — and pair the assertions across two code paths, so the same
invariant is checked on the way in and on the way out, or on both branches of a decision. Split a
compound assertion so the failure names which half broke, use a single-line `if` for an implication,
and let a blatantly-true assertion stand as documentation of a relationship the code depends on,
such as the ordering of two constants.

Two assertions per function is a floor, not a target, and an assertion is a safety net rather than a
substitute for understanding: it reports a programmer error, not bad input, so it guards what the
code already believes rather than validating what arrives from outside. An assertion that can never
fire is documentation; one that fires in production is a bug report, and both are worth the line.
