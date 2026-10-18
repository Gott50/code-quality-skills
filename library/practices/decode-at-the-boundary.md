---
id: decode-at-the-boundary
title: Decode external data at the boundary, then trust the type
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Decode external data once, at the boundary where it enters the program, and let every caller inside
the boundary work with a type that has already been checked.

A type annotation on parsed data is a claim the compiler believes and nothing verifies. `JSON.parse`
returns `any`, an `as T` narrows it to whatever the author hoped for, and the assertion tells the
reader nothing about whether the value matches — the check that would have failed at the boundary
is deferred to wherever the first property access throws, far from the input that was wrong. A
validator at the boundary is the same information asserted once, at the point where the data is
still known to be untrusted.

The boundary is a real location: an HTTP handler's parsed request, a config file read at startup, a
message off a queue, a response from a service you do not control. Inside it, a value that arrived
through a validated decode is trusted, and `any` is not needed. Outside it — the core — a second
validation is a sign the boundary was not trusted, and the fix is to move the validation to the
boundary, not to validate twice.

Where the shape is known, model it — a discriminated union, a branded type, a class that validates
in its constructor — and use `unknown` at the edge until the decode succeeds. An assertion without
a validator is the one habit this rule exists to break, and where an assertion genuinely survives,
it says in a comment what guarantees it.
