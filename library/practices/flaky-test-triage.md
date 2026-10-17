---
id: flaky-test-triage
title: Quarantine, root-cause, eliminate — never retry
when: { requires: [{ testFile: true }] }
source: research/best-practices-coverage.md
enforcedBy: []
---

Treat a flaky test as a bug to root-cause, not a flake to retry past: quarantine it, find the
cause, and eliminate the cause.

A retry turns a real defect into a passing run. The test failed because something non-deterministic
happened — a clock, an unawaited promise, a shared mutable fixture, an ordering assumption, a
network call the test did not stub — and the retry hides which. A suite that re-runs its failures
reports green on the same code that will fail in production, so the flake is not a nuisance to
tolerate; it is the signal the runner is designed to give and the retry is designed to discard.

Quarantine is the expedient, not the fix: move the test out of the blocking set with a tracking
note that names the owner and the condition, so the rest of the suite stays trustworthy while the
cause is investigated. Quarantine buys the time to root-cause; it does not substitute for it, and a
quarantined test with no follow-up is a deleted test that still costs a run.

Then remove the source of non-determinism rather than the assertion that noticed it — inject the
clock, seed the randomness, reset the state between tests, stub at the boundary. A test whose
flakiness cannot be reproduced deterministically has not been diagnosed; it has been made rare, and
the next CI run is the one that tells you.
