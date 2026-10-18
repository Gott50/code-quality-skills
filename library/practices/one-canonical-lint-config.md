---
id: one-canonical-lint-config
title: One canonical lint config
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Keep one canonical linter config, and put every rule that applies project-wide in it rather than
spreading lint decisions across a second config file, a per-directory override, and inline
directives.

Two configs that both set a rule do not compose into a stricter lint — they compose into a rule
that fires in one path and not the other, and a reader who has to open three files to know whether
a rule is on will eventually stop checking. The canonical config is the file a contributor opens
first; if a rule lives somewhere else, it is a rule the canonical config is lying about.

Per-directory overrides have a legitimate use: a directory with a genuinely different runtime —
tests, scripts, generated shims — where a rule's assumption does not hold. The override is a
statement about that directory, not a place to try a rule on before turning it on everywhere. A
rule worth taking seriously is turned on in the canonical config, and a rule not worth that is
removed.

The same holds for a second linter added beside the first. If both are installed, the canonical
config names what each owns and why the second is not redundant; a second linter that re-reports
the first one's findings does not add coverage, it adds a second place to look when the first one
fails.
