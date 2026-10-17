---
id: lint-suppressions
title: A suppression explains itself
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/lint-typecheck.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Give every disable directive a reason, and delete it when it stops suppressing anything.

A suppression is a claim that the rule is wrong here. The claim is only reviewable if it says why,
so a disable comment without a reason is a hole nobody can audit — the next reader cannot tell
whether the rule was wrong or the code was.

A suppression that no longer suppresses anything is worse than none: it hides the fact that the code
changed, and it makes the next reader think a rule is being deliberately waived. A run that reports
unused directives turns that into a failure, which is the only way the set stays honest.

Prefer the config to the comment. A rule that is wrong for a whole directory belongs in the config's
overrides, where it is visible and scoped; an inline disable is for the one line that is genuinely
an exception, and it should be rare enough that each one can be read.
