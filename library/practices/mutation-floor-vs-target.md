---
id: mutation-floor-vs-target
title: The score is a floor, never a target
when: { language: [typescript, javascript], requires: [{ testFile: true }] }
source: research/mutation.md
enforcedBy: [stryker-mutation, stryker-mutation-vitest]
---

Treat the mutation score as a floor you never lower, never as a target you chase.

A floor records the level the project already measures and holds it there; it moves up only after a change has been verified, and it never moves down to make a run green. A target is a different thing: it names a level to reach, and reaching it late — after the work is "done" — pushes you toward the easy fix. A test coupled to the code kills a mutant quickly and makes the codebase harder to change; a test that pins the contract is harder to write and is the one worth having.

The field's practitioners say the same thing from opposite ends. PIT's author, who has run mutation testing for over a decade, does not use a target at all: it does not solve the problem and can make things worse. Google does not compute a score for developers, because it is difficult to act on; it surfaces a small sample of live mutants as review findings instead.

The failure mode to watch for: a number that only ever goes up because the tests got more coupled, not because the code got more correct. If a green run required a test that would fail on any refactor, the floor was met and the practice was lost.
