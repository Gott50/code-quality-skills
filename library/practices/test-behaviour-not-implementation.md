---
id: test-behaviour-not-implementation
title: Test behaviour, not implementation
when: { requires: [{ testFile: true }] }
source: research/testing.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Assert observable behaviour, not the calls a collaborator received.

A test earns its place by failing when the behaviour it names changes. An assertion on the calls a
mock received fails when the interaction changes even though the observable result did not, so it
couples the test to the implementation and turns every refactor into a test rewrite. Assert the
state of the system under test and its collaborators after exercising it; reach for a double only
where a real collaborator is awkward, such as a remote service.

Prefer real collaborators and assert on their state. When a collaborator must be replaced, replace
it with a faithful implementation behind a real interface — a service layer, a repository, a port —
rather than intercepting a module. A double that records calls is a last resort for the one
interaction that has no observable result, and even then the assertion should name the outcome the
call produces, not the call itself.

The judgement is which assertions name behaviour. A test that asserts a returned value, a persisted
row, or an emitted event is testing behaviour; one that asserts a method was called with particular
arguments is testing the implementation. When a test breaks on a refactor that changed no
observable behaviour, the assertion is the defect.
