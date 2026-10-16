---
id: test-behaviour-not-implementation
title: Test behaviour, not implementation
when: { testFile: true }
source: research/testing.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Assert observable behaviour — the return value or resulting state the caller depends on — not the calls a mock received.

A test that asserts on a mock's call log is coupled to the implementation, not to the contract: it fails when the interaction changes even though the observable behaviour did not, and it passes when the implementation is wrong as long as the wrong code still calls the mock the way the test expects. Both directions are the same defect — the assertion names *how* the code works instead of *what* it does.

Prefer real collaborators and assert on their resulting state. Reach for a double only for an awkward collaborator — a remote service, a clock, a random source — and assert on the outcome it produced, not on the sequence of calls it recorded. When a test can only be written by asserting a call log, the seam is in the wrong place: inject the dependency through a real interface and assert on what the caller observes.

The failure mode to watch for: a green test that would still pass if the implementation were wrong, because it asserts on the mock's call log rather than on the result. If the assertion cannot fail when the behaviour changes, it is not testing behaviour.
