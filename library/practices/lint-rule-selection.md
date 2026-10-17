---
id: lint-rule-selection
title: Enable a rule only when its report is actionable
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/lint-typecheck.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Enable a rule only when a report on it always leads to an action.

A config can run whatever it lists; it cannot decide that a rule is noise for this project. That
decision is the one a gate cannot make, and it is the one that decides whether the gate survives: a
rule whose reports are usually wrong trains the team to ignore the whole run.

The test is what happens on a report. If every report is a defect someone fixes, the rule earns its
place. If a report is usually a false positive, or a preference nobody will act on, the rule costs
attention and buys nothing — and the cost is paid by the rules that do matter.

So select rules by the action they produce, not by the category they belong to. A rule that is right
most of the time but needs a human to look is a candidate for a warning, not for the gate; a rule
that is always right is a candidate for the gate. The library ships a set that has passed that test;
a project adding to it should apply the same test.
