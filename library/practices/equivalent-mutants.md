---
id: equivalent-mutants
title: An equivalent mutant is a decision, not a survivor
when: { language: [typescript, javascript], requires: [{ testFile: true }] }
source: research/mutation.md
enforcedBy: [stryker-mutation, stryker-mutation-vitest]
---

Decide per mutant whether to rewrite the code, suppress it, or accept it — never let an equivalent mutant sit unexplained.

An equivalent mutant is syntactically different but functionally identical to the original, so no test can ever kill it. Detecting them is undecidable, and they are common — the field's estimate is 10% to 40% of all mutants — so a score below 100% is the normal state, not a defect. What matters is that each permanent survivor has an answer.

There are three ways to answer, and they trade reach against precision. Excluding a mutator turns it off for every file, which is a shotgun: it hides the real survivors that mutator would have found alongside the equivalent ones. A `// Stryker disable` comment names one line and carries a reason, which is the surgical tool. An ignore-plugin drops a pattern that recurs across files, which is the right shape when the same construct keeps producing the same unkillable mutant. The fourth answer is to rewrite the code so the mutant cannot occur — the most expensive and the most durable.

The failure mode to watch for: a global exclusion added to make a run green, which quietly stops measuring a whole class of change. Prefer the narrowest mechanism that answers the mutant in front of you, and leave the reason where the next reader will find it.
