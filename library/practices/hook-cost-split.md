---
id: hook-cost-split
title: Put a gate in pre-commit only if it is fast
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/ci-hooks.md
enforcedBy: [biome-assist, biome-assist-npm, oxlint-anti-slop, oxlint-anti-slop-npm, tsconfig-strict, tsconfig-strict-npm, bun-test-coverage, vitest-coverage]
---

Put a gate in `pre-commit` only if it finishes in the time a developer will tolerate at `git
commit`; everything slower belongs in `pre-push` or CI.

The split follows the cost of the check, not its importance. A commit is a small, frequent action,
so the gates that run there must be scoped to the change and cheap: format the staged files, lint,
typecheck, run the suite. A push is rarer and already a network operation, so it can carry the
per-mutant and whole-project checks. The placement is a judgement about latency, and the library
records it as the recipe's `cost` — the field states the decision, it does not make it.

The failure mode of getting this wrong is not a slow commit. It is a skipped hook: a developer who
pays minutes per commit learns `--no-verify`, and the gate stops running for the person it was
meant to protect. Because the bypass is all-or-nothing, one slow gate in `pre-commit` takes the
fast ones down with it.

So when a check is too slow for `pre-commit`, do not move it there and hope. Scope it to the
change, move it to `pre-push`, and let CI run it on every pull request — where it is enforced
rather than merely offered.
