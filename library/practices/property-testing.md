---
id: property-testing
title: Write a property where an example cannot pin the rule down
when: { requires: [{ testFile: true }] }
source: research/best-practices-coverage.md
enforcedBy: []
---

Reach for a property — an invariant that must hold for every input — where a hand-written example
would only ever pin down one case, and keep the failing counterexample as the regression.

A table of examples is the right tool when the input space is small and enumerable: it says what
each input yields, and a reader can check it. A property is the right tool when the space is large
or the rule is relational: an encode/decode round trip is the identity, a sort is idempotent and
preserves length, a parse of valid input never throws, a comparator is a total order. Those claims
cannot be exhausted by examples, and the generator explores the shapes a reader would not think to
write — which is the point, because the edge cases are the ones a hand-written table forgets.

The generator's shrinking is what makes a failure useful: it reduces the counterexample to a
minimal input before reporting it, so the failure names the smallest input that breaks the
property rather than an arbitrary large one. Record the seed when a run is not reproducible, and
keep the shrunk input as an ordinary example test so the regression is checked on every run.

Use a property where the property is a real invariant and an example where the expected value is
the requirement. A property over a rule nobody has stated is a generator searching an unconstrained
space, and the failure it finds is a spec question rather than a bug.

The judgement is recorded in [the best-practices coverage note](../../research/best-practices-coverage.md).
