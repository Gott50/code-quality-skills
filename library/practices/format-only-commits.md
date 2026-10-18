---
id: format-only-commits
title: Keep a reformat out of a logic commit
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: [biome-assist, biome-assist-npm, eslint-prettier]
---

Land a formatter's sweep as its own commit, so a change that touches behaviour and a change that
touches only whitespace never share a diff.

A reformat rewrites lines the logic change did not intend to touch. When both land together, the
reviewer sees a diff dominated by reflowed code and has to reconstruct which lines are the real
change, which is exactly the work the formatter was supposed to remove. A dedicated format commit
is trivially reviewable — the reader checks that nothing but formatting changed — and it leaves the
logic commit small enough to read.

The one-time sweep that adopts a formatter is the extreme case and gets its own commit for the same
reason, on a branch whose only purpose is that sweep. After that, formatting is the formatter's job
on every save, so no commit needs to mix the two: the code is already formatted, and the format
commit is only the sweep. A commit that reformats a file it did not otherwise touch is a sign the
formatter was not run where it should have been.

When a logic change and its reformat genuinely must ride together — a rename that changes line
lengths, say — say so in the message. The rule is about the diff a reader can trust, and a stated
reason is what makes the two readable together.
