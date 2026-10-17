---
id: hook-auto-stage
title: Decide whether the hook fixes and re-stages, or fails
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/ci-hooks.md
enforcedBy: [biome-assist, biome-assist-npm]
---

Decide whether the hook fixes the file and re-stages it, or fails and hands the fix back — and
make the choice explicit.

A formatter in a hook can do either. Fixing and re-staging keeps the commit moving and is what
`lint-staged` does by default: the task rewrites the file, the hook stages the rewrite, and the
commit carries the formatted content. Failing instead — `--fail-on-changes` — leaves the fix in the
worktree and makes the developer re-read and re-stage it, which is slower but keeps the committed
content exactly what was reviewed.

The library's formatter hook fixes and re-stages, and it pays for that with a guard: it refuses to
run when a staged file also has unstaged changes, because re-staging would commit a blend of
reviewed and unreviewed content. Any hook that rewrites the worktree needs that guard, or the
re-stage silently widens the commit.

The choice is a judgement, not a gate. What is not a judgement is consistency: a hook that
sometimes fixes and sometimes fails is worse than either, because the developer cannot predict
whether the commit they are about to make contains what they staged.
