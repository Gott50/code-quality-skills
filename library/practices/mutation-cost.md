---
id: mutation-cost
title: Pay for mutation testing only where someone acts on it
when: { language: [typescript, javascript], requires: [{ testFile: true }] }
source: research/mutation.md
enforcedBy: [stryker-mutation, stryker-mutation-vitest]
---

Pay for mutation testing only where someone acts on the result, and scope the run to the change.

Mutation testing is the most expensive gate in the library, and the cost is all in the running: you gain nothing from a run nobody reads. The levers are scope, cache, coverage analysis, concurrency, timeouts and the number of mutants — and the first is the one that matters. A run scoped to the changed files, reusing the incremental cache, is affordable on every push; a full-suite run is not, and a full-suite run scheduled overnight is the one that gets ignored.

The question is not "is mutation testing good?" but "who reads this, and when?". A repo with no tests cannot have a meaningful mutation gate at all — the fix is to write tests, not to wire the gate. A question outside the tool's reach — a bug in a protocol or a specification — will not be found by any mutant, however many you generate.

The failure mode to watch for: a heavy gate that runs on every push, is slow enough to be skipped, and is therefore never enforced. A gate that is bypassed is worse than no gate, because it reads as coverage.
