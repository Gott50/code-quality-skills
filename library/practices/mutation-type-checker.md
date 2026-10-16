---
id: mutation-type-checker
title: The TypeScript checker trades run time for honest survivors
when: { language: [typescript, javascript], requires: [{ testFile: true }] }
source: research/mutation.md
enforcedBy: [stryker-mutation, stryker-mutation-vitest]
---

Weigh the TypeScript checker by the trade it makes — honest survivors against run time — and set it deliberately.

Without a checker, a mutant that does not compile is reported as a survivor: the test run fails for a reason that has nothing to do with the tests, and the score counts it against you. The checker validates each mutant against the type system before the tests run, so a type error is reported as a compile error and leaves the score alone. The cost is real — a type-check per mutant — and it is the same trade as every other lever: accuracy against time.

The trade is worth taking when the code is typed and the run is already scoped to the change, because the added time is bounded and the survivors you keep are the ones a test could actually kill. It is not worth taking when the run is a full-suite sweep nobody reads, or when the project's types are so loose that the checker has little to say.

The failure mode to watch for: a survivor that is really a type error, chased with a test that asserts the broken behaviour. If the mutant does not compile, the answer is the type, not the test.
