---
id: lint-debt
title: Fix, suppress, or record — never ignore
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/lint-typecheck.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm, tsconfig-strict, tsconfig-strict-npm]
---

Decide per violation: fix it, suppress it with a reason, or record the level — never leave an error
the team has learned to ignore.

A rule that fires on legitimate code has three honest outcomes: fix the code, suppress the report
with a reason, or record the level and stop failing on it. The dishonest fourth is to leave it as an
error the team has learned to ignore, which costs the gate its authority for every other rule.

The recorded level is a ratchet, not a wall: it grandfathers the debt that exists and fails on what
a change adds. That is what makes a strict rule usable on a repo that already carries violations —
the new code is held to the rule, the old code is not rewritten to satisfy it.

The judgement is whether to spend the effort. A violation in code someone is about to touch is worth
fixing; one in a file nobody will open again is worth recording. What is never worth doing is
lowering the level to make a new violation pass, because that is the one move that makes the gate
meaningless.
