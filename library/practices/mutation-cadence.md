---
id: mutation-cadence
title: Run mutation on pull requests, not on every push
when: { language: [typescript, javascript], requires: [{ testFile: true }] }
source: research/ci-hooks.md
enforcedBy: [stryker-mutation, stryker-mutation-vitest]
---

Run mutation on pull requests, not on every push to the main branch.

Mutation is the slowest gate the library installs: it runs the suite once per mutant, and even
with incremental caching the dry run alone is a full test run. Paying that on every push to main
buys nothing — the change already passed the gate on its pull request, and the merge commit is the
same code. The gate belongs where the decision is made, which is the pull request.

The local approximation is the `pre-push` hook, scoped to the pushed files. It is not a substitute
for the pull-request job: it is bypassable, and it only sees what the developer pushed. The two
exist together because they answer different questions — the hook gives fast local feedback, the
job is the enforcement.

A repository with a small, fast suite can reasonably run mutation on every push; the library does
not, because the default has to survive a suite that is not small. If you change the cadence, state
it in the workflow rather than in a comment, so the next reader can see which events the job
actually runs on.
