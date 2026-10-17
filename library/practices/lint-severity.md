---
id: lint-severity
title: Severity is a switch, not a dial
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/lint-typecheck.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Set a rule to `error` only when its report always means the code is wrong; otherwise `warn` it or
leave it off.

A linter has three severities, not a dial: `off`, `warn`, and `error`. Only `error` changes the exit
code, so a warning is inert unless the run is configured to fail on warnings. That makes the real
question "does this rule's report always mean the code is wrong?", not "how much do we care?". A
rule whose report is always a defect belongs at `error`; a rule that is right most of the time and
needs a human to look belongs at `warn`, or off.

The taxonomy that answers the question is the linter's own. A rule that flags code which is
definitely wrong or useless is a correctness rule; a rule that flags a style preference, or that is
documented to have false positives, is a suggestion. Promoting a suggestion to `error` is how a
config earns the reputation that gets it ignored: the build fails on code that is not wrong, and the
team learns to route around the gate.

The library's config sets every rule to `error` and absorbs the existing debt as a count. That is a
deliberate choice, not a licence to promote a noisy rule: a rule that fires on legitimate code must
be `warn`, suppressed with a reason, or fixed — never an `error` the team has learned to ignore.
