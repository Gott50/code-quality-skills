---
id: lint-test-exemptions
title: Relax in tests only what tests make meaningless
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/lint-typecheck.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Exempt test files from the rules that measure production shape, and from nothing else.

A test file is not production code, and the rules that measure production shape do not mean the same
thing there. A size cap or a statement cap on a test file forces the assertions to be condensed,
which is exactly the wrong trade: the test's value is in the assertions, and a cap that pushes them
into a loop or a helper makes the failure harder to read.

The exemption is per-rule, not per-file. A test file is still code: the correctness rules apply to
it in full, and so do the rules that keep a test honest — an assertion that cannot fail is a defect
in a test file as much as anywhere else. Exempting a whole file from the linter is how a test file
becomes the one place nobody looks.

The judgement is which rules measure shape and which measure correctness. The first set is the one
to relax in tests; the second is the one to keep, because a test that violates it is a test that
will not fail when it should.
