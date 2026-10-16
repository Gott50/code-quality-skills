---
id: test-naming
title: Name the behaviour, not the method
when: { requires: [{ testFile: true }] }
source: research/testing.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Name each test for the behaviour it checks, not the method it calls.

A failing test's name is the first thing a reader sees, and it should say what broke without opening
the file. "greet adds an exclamation mark when excited" names the behaviour; "test greet" names the
method and tells the reader nothing they could not read from the call. State the condition and the
expected outcome, in the vocabulary of the domain rather than the code.

A name that describes the implementation — the private method, the internal branch — has to change
whenever the implementation does, which is exactly when a test should not have to. Name the
observable behaviour, so a refactor that preserves it leaves the name true.

The name is also the test's documentation: a reader scanning the list of names should be able to tell
what the unit does and what it does not. If two names describe the same behaviour, one of the tests
is redundant.
