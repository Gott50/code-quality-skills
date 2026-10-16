---
id: never-failing-tests
title: A test that never fails is not a test
when: { requires: [{ testFile: true }] }
source: research/testing.md
enforcedBy: [stryker-mutation, stryker-mutation-vitest, bun-test-coverage, vitest-coverage]
---

Delete, strengthen, or justify a test that cannot fail.

A test that cannot fail is worse than no test: it reports green, it costs time on every run, and it
tells the next reader that the behaviour is covered when it is not. Three shapes are common. A test
with no assertion runs the code and passes whatever it does. A test in a file no other test imports
never runs at all. A test that runs the code but asserts something the code cannot change survives
every change to that code.

The first two are mechanical: add the assertion the test's name promises, or delete the test. The
third is the one that needs judgement. A test that survives a change to the code it exercises is
either asserting the wrong thing — a constant, a tautology, a value the test itself set — or
guarding a property no change can express, such as a public API's shape or a serialized format.
Strengthen the first; keep the second only with a comment saying what it guards and why nothing else
covers it.

A test that fails only in a particular order or on a particular run is the same problem from the
other side: it is not testing the behaviour, it is testing the shared state. Make it independent, or
delete it.
