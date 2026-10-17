---
id: baseline-vs-fix
title: A baseline is a ratchet, not a wall — and not a place to hide new debt
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/dead-code-complexity.md
enforcedBy: [fallow-audit, fallow-audit-npm]
---

Baseline a finding only when you can explain the exception in one sentence; otherwise fix it.

A wall says "zero findings, forever"; a baseline says "no new findings, the recorded ones are
grandfathered". The difference is the whole point, and it is what makes a gate usable on a repo
that already carries debt. The two rollout strategies are warn-everywhere, where CI never blocks
and the risk is that a gate which only warns stays that way forever, and error-plus-baselines,
where CI blocks on new issues while the existing debt in the files a change touches is
grandfathered. The second is the one that keeps the gate alive.

A baseline is a ratchet, so it only ever tightens. The raise step (`--raise`) merges the current
level into the recorded one and the floor never falls on its own: a repo that drops below its floor
stays red, and the fix is to fix the code, not to lower the floor. Regenerate the baseline on a
schedule — quarterly, or per release — never per merge, because a baseline regenerated on every
merge absorbs the new debt each time CI runs and nobody sees it. A baseline that has gone stale
silently stops suppressing, and a baseline can be grown in the same commit that adds the finding,
which is why the staleness and growth checks exist: they are what make the committed baseline
shrink-only.

The judgement is which findings are worth fixing and which are worth baselining. The tool gives the
order and the keep-list but not the decision, and the decision is the one thing a gate cannot make
for you. If you cannot explain an exception in one sentence, you probably use the wrong mechanism.
