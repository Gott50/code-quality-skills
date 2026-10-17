---
id: complexity-triage
title: The threshold reports, the rule gates — and a legacy hotspot gets a documented ceiling
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/dead-code-complexity.md
enforcedBy: [fallow-audit, fallow-audit-npm]
---

Treat the complexity threshold as a reporting filter and the rule severity as the gate, and give a
known-legacy function a documented ceiling rather than a suppression.

The two knobs are easy to conflate and they do different things. The threshold decides which
functions appear as findings; the rule severity decides whether a finding fails the run. Lowering a
threshold reports more, it does not fail more. Setting a rule to `warn` keeps the finding in every
output format and exits zero. So a repo that wants a stricter report without a stricter gate lowers
the threshold, and a repo that wants a stricter gate promotes the rule — and neither is a
substitute for the other.

The false positives are documented, not hypothetical: generated files (GraphQL codegen, a Prisma
client, OpenAPI types) have high complexity density and should not be refactored; a test file with
many `it()`/`test()` blocks scores high and is usually fine; a config file shows up as a hotspot
because it changes often during setup. The two complexity metrics are not redundant either — a flat
`switch` scores high cyclomatic and low cognitive, a three-deep `if` chain the reverse — so a gate
on one alone fails readable dispatch tables and passes unreadable nesting. CRAP is the one metric
that is a correctness signal rather than a style signal, and it is the one that needs measured
coverage to mean anything: without a coverage artifact it scores an estimate, and the estimate is
wrong in both directions.

A known-legacy function gets a documented local ceiling — a `thresholdOverrides` entry with a
`reason` — never a suppression comment, because an override keeps the exception visible in the
output while a suppression hides it. Raising the global threshold is acceptable only when the new
threshold is a considered project standard with a written justification. The judgement the tool
cannot make is whether a complex function is intentional: a parser, a state machine and a generated
file all score high and should not be refactored.
