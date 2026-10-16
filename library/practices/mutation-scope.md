---
id: mutation-scope
title: Mutate production code, and decide what production code is
when: { language: [typescript, javascript], requires: [{ testFile: true }] }
source: research/mutation.md
enforcedBy: [stryker-mutation, stryker-mutation-vitest]
---

Mutate the production code, and decide what production code is before you widen the scope.

The mutation scope is a claim about which files carry behaviour a test could pin down. Test files, type-only files, generated clients, process entrypoints and build scripts are not that: their mutants are either unkillable or uninteresting, and every one of them dilutes the score without teaching anything. A file that is production code but sits outside the scope is the worse mistake — it is silently unmeasured, and the score reads as if it did not exist.

The shipped scope is a default, not a verdict. Widen it when the project's source does not live where the default looks, and narrow it when a file inside it is a re-export barrel, a constant table, or a generated artifact whose mutants are all equivalent. Judge each candidate by whether a test could fail on a change to this file, not by whether the file is hard to test.

The failure mode to watch for: a scope that grew to include a file nobody will ever write a test for, so the floor is held down by mutants that can never be killed and the number stops meaning anything.
