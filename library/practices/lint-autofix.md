---
id: lint-autofix
title: Auto-fix what the tool can fix
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/lint-typecheck.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm, biome-assist, biome-assist-npm]
---

Apply the fixer's safe fixes instead of reporting them.

A linter separates two remedies. A **fix** corrects the violation without changing application
logic, and the tool applies it; a **suggestion** may change behaviour, so it cannot be applied
unattended and is offered only to an editor. A rule that ships a fix is nearly free to enforce,
because the remedy is mechanical and the gate is a zero-diff check; a rule that ships only a
suggestion demands a human edit per report.

So run the fixer, not only the reporter. The safe tier is the one to run unattended;
the suggestion tier changes program behaviour and belongs behind a deliberate decision; the
dangerous tier belongs behind a review. Which tier a fix sits in is a property of the rule, not of
the project — a fix that only rewrites syntax can run on every commit, while a fix that rewrites a
type or a call needs a human to read the diff.

The judgement is which tier to run where. When a rule's fix is off by default, that is the tool
telling you the fix is a suggestion: switching it on is a decision about the code, not a
configuration preference.
