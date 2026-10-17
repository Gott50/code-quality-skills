---
id: define-errors-out-of-existence
title: Reshape the interface instead of adding a handler
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: []
---

Reshape the interface where that removes an error — a design that makes the bad state
unrepresentable beats a handler that catches it.

An error condition that recurs at every call site is usually a shape problem wearing an error's
clothes. `first()` on an empty list forces every caller to guard; `firstOrNull()` moves the
decision into the one place that knows whether an empty result is meaningful. A `DateRange`
constructed with start before end throws for every caller to handle something that could not exist
if the constructor refused it. The handler is defensive code repeated at each call site; the
redesign removes the reason for all of them at once.

Not every error disappears this way. Failures that come from outside the program — a network, a
file, a user — are real and stay. The question is whether *this* error is one of those or one the
interface chose to allow: an invariant the type system could carry, a null the API could have
modelled as an absence, a precondition a validated type would have enforced. Where the answer is
"the interface allowed it", the fix is in the interface.

The trade is effort against repetition: a redesign costs once, and a handler costs at every call
site and every future one. Prefer the encoding — a branded type for a positive integer, a
non-empty list, an optional value where absence is normal — and keep the thrown error for what
genuinely cannot be prevented.
