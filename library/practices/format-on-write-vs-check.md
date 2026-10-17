---
id: format-on-write-vs-check
title: Format on write locally, check only in CI
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/formatting.md
enforcedBy: [biome-assist, biome-assist-npm, eslint-prettier]
---

Format on write in the local hook and check only in CI; the hook keeps the wall from firing, the CI check is the enforcement.

These are two different jobs, and the tools name them separately. Format-on-write mutates the worktree: Prettier's `--write` rewrites the processed files in place, and Biome's `--write`/`--fix` applies formatting, safe lint fixes and safe assist actions. Check-in-CI never modifies files and exits non-zero: `biome ci` runs the same checks without writing. A CI job that rewrites files is not a check — it either fails on the diff it just produced or silently discards it.

The relationship is the one Prettier's own docs state: the hook exists to minimise the number of times the CI check finds unformatted files. The hook is a convenience; the CI check is the enforcement, because it is the only one that cannot be bypassed. A hook that only checks is a legitimate choice too — the library's ESLint + Prettier hook runs the check, not the write — but the CI side must be check-only in every case.

The judgement is which side writes. Writing locally is faster for the author and keeps the diff out of the commit; checking locally is safer when the formatter's output is not obviously behaviour-preserving. What is not a judgement is that the CI side never writes.
