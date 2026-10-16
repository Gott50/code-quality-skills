---
id: one-reason-per-test
title: One reason to fail per test
when: { requires: [{ testFile: true }] }
source: research/testing.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Give each test one reason to fail: one action, one expected change.

A test that checks several unrelated things reports one failure for several causes, and the first
failure hides the rest. Structure the test as given-when-then: the preconditions, the single action
under test, and the single change it should produce. When a second expectation does not follow from
the same action, it belongs in its own test.

Several assertions can share one reason. Asserting three fields of the object the action returned is
one reason to fail, because the action and the expected change are the same; asserting the return
value and a log line is two. The count is a heuristic, not the rule — the question is whether a
reader can name the one behaviour the test checks.

A test that needs the word "and" to describe what it does is two tests. Split it, and let each half
fail for its own reason.
