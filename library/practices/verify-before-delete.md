---
id: verify-before-delete
title: Verify a dead-code finding before you delete the code it names
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/dead-code-complexity.md
enforcedBy: [fallow-audit, fallow-audit-npm]
---

Verify a dead-code finding before you delete the code it names.

A finding is only as correct as the module graph behind it. When code uses an export through a
dynamic pattern the graph cannot resolve, the finding is a false positive, and the trace view is
what shows it — so trace the finding before you act on it. When the decision depends on the exact
identity of a declaration, ask for the type-aware pass: it removes a candidate only when the
checker resolves that identity, and when the analysis is partial or unavailable it keeps the
original finding and reports a stable omission reason rather than guessing. Where partial evidence
must fail the run, require the complete mode, which fails the job when semantic evidence is
incomplete.

An incomplete analysis blocks the automatic fix. A finding carries reachability caveats when the
analysis could not see the whole picture, and the tool then offers no removal — not in the fix
command, not in an editor quick fix, not in a one-click review suggestion. The auto-fixable flag is
per finding, not per action type: the same action can be safe on one finding and unsafe on another.
The fix command is deliberately narrower than detection: it removes unused exports and unused
dependencies, it never deletes a whole file, and it removes a class method only when type-aware
analysis gives complete evidence that the method is unused and the declaration still matches the
analyzed source.

The judgement is whether the finding is real at all. The documented false-positive classes are all
judgement: a class member wired by dependency injection, a type a library consumer uses, a
framework's convention-based export, a file in a hidden directory. None of them is a configuration
problem to be silenced; each is a decision about whether the code is reachable from outside the
repository.
