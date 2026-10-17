---
id: hook-parallelism
title: Run the hook's gates serially unless they are independent
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/ci-hooks.md
enforcedBy: [repo-hygiene, repo-hygiene-npm]
---

Run the hook's gates serially unless they are independent and the hook is the bottleneck.

A hook is a shell script, and its gates are commands that each exit non-zero on failure. Running
them in parallel is a real option — some hook runners expose it as a single flag — but it changes
what a failure means: the hook can no longer stop at the first red gate, and the output of several
gates interleaves. Serial execution gives the developer the first failure, in order, with the
output of one gate at a time.

The library's hooks run serially, one marker block per recipe, in the order the recipes were
applied. That is also what makes the blocks attributable: each block is one recipe's gate, and a
reader can see which recipe owns which lines and remove exactly that block.

Parallelism is worth revisiting when the gates are genuinely independent and the hook's wall time
is dominated by waiting rather than by work — a formatter and a typechecker do not share state, but
a formatter that rewrites the worktree and a test run that reads it do. Decide it per hook, and
state the decision where the hook is defined.
