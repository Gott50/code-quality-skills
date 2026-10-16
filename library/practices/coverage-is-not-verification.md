---
id: coverage-is-not-verification
title: Coverage is not verification
when: { language: [typescript, javascript], requires: [{ testFile: true }] }
source: research/coverage.md
enforcedBy: [stryker-mutation, stryker-mutation-vitest]
---

Treat coverage as evidence that code ran, never as evidence that it was verified.

Coverage measures execution, not verification. A test with no assertion still executes the code it calls, so a suite of assertion-free tests reports 100% and proves nothing; a per-file floor makes the *file* honest, not the test. The gate that measures assertion strength is the mutation floor: a mutant that survives is a test that did not fail, and that is the only signal that separates a test from a call.

The number is also easy to game in ways the floor cannot see: a file excluded from the denominator, a branch ignored, a test that calls a function and asserts nothing. When the number goes up, ask what it now executes that it did not before, and whether anything asserts the result; when it goes down, ask which behaviour lost its test. The number is a floor to hold, not a target to chase.

Two failure modes are worth naming because they are properties of the ratchet, not of the tests. A repo that never raised a baseline is gated at the wall, which is red from day one and trains everyone to ignore it. And a floor that rises on its own turns every unrelated change into a candidate for a red build. Both are reasons to raise the floor deliberately, at the level the project measures, and never automatically.
