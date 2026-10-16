---
id: test-boundary
title: Draw the unit boundary deliberately
when: { requires: [{ testFile: true }] }
source: research/testing.md
enforcedBy: []
---

Decide what a unit is for this codebase, and write tests that establish clear boundaries.

The unit/integration distinction is not agreed on: the same word means a single function to one team
and a module with its real collaborators to another, so a debate about which tests are "unit" tests
settles nothing. What survives is the goal — tests that establish clear boundaries, run quickly and
reliably, and fail only for useful reasons. Pick the boundary that makes those three true for this
codebase and write it down, so the next test follows it.

The two useful axes are the boundary and the collaborators. A test that exercises one module with
its real collaborators is fast and catches integration mistakes; a test that replaces an awkward
collaborator — a network, a clock, a filesystem — is faster and more deterministic but proves less.
Neither is better in the abstract; the mix should follow the cost of the failure each one catches.

The boundary is a team decision, not a technical one, and it should be written down where the tests
live. A codebase that has not decided will drift: some tests replace every collaborator, others
reach for the network, and the suite becomes slow and flaky in ways no single test explains.
