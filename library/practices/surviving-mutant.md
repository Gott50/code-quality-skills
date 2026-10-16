---
id: surviving-mutant
title: A survivor is a test that did not fail
when: { language: [typescript, javascript], requires: [{ testFile: true }] }
source: research/mutation.md
enforcedBy: [stryker-mutation, stryker-mutation-vitest]
---

Read a surviving mutant as a test that did not fail, and decide which of the three things that means for this code.

A survivor is a concrete test goal, not a bug report. It says a test executed the mutated line and did not check the consequence, so the first reading is a missing assertion. The second is an equivalent mutant, which no test can ever kill. The third is a coverage gap wearing a survivor's label: `No coverage` and `Survived` are different signals, and only the second says a test ran. A survivor whose mutant run executed zero tests is none of the three — it is meaningless rather than merely low, and it must be read as a broken run, not a weak test.

Mutation testing answers a narrow question: whether the algorithm is correctly implemented, not whether the correct algorithm is implemented. A survivor on a line whose behaviour is genuinely unspecified is not a missing test; it is a specification gap, and the fix is a decision, not an assertion.

The failure mode to watch for: writing a test that asserts the mutated line's current output, which kills the mutant and pins the implementation in place. A survivor is a prompt to ask what the code is supposed to do, not a prompt to record what it does.
