---
id: test-isolation
title: A test starts from a known state, not from the previous test
when: { requires: [{ testFile: true }] }
source: research/best-practices-coverage.md
enforcedBy: []
---

Give every test its own state — fresh fixtures, an isolated database or a transaction rollback,
reset counters — so it passes when run alone, when run in a different order, and when run in
parallel.

A shared mutable fixture couples the tests to each other. The suite passes in the order that
happens to exist, and the failure appears later as a test that is "flaky" when it is really the
second test to depend on what the first one left behind. That symptom presents on the test that
observes the leftover, so the named test is rarely the one that holds the state.

Prefer a fresh object per test over a `beforeAll` that mutates, and a per-test transaction over a
suite-wide seed. Where a suite genuinely shares an expensive resource — a container, a server —
share the resource and reset the state on it per test, rather than sharing the state itself.

Parallelism is the test of the discipline: a suite that only passes with `--runInBand` has an
ordering dependency that is invisible on one worker. If the runner supports concurrency, the
isolation has to hold under it, because running the same suite with a different worker count is a
supported configuration and not a special case.

The judgement is recorded in [the best-practices coverage note](../../research/best-practices-coverage.md).
