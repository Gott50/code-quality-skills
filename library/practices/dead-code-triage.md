---
id: dead-code-triage
title: Triage dead code in fix order, and keep an export only through an auditable mechanism
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/dead-code-complexity.md
enforcedBy: [fallow-audit, fallow-audit-npm]
---

Work the dead-code findings in the tool's fix order, and keep an export only through a mechanism
that stays auditable.

The order is correctness first, hygiene second: unresolved imports, unlisted dependencies,
boundary violations, unused files, unused dependencies, unused exports, circular dependencies,
type-only dependencies, test-only dependencies, duplicate exports, stale suppressions, then unused
types, enum members and class members. The first two can cause a runtime failure, so they are never
baselined; the rest are maintenance. Unused files are almost always worth acting on — the usual
false positive is a script run directly or a file a tool loads, and both are fixed by declaring an
entry point, not by baselining. Unused exports are worth removing, or worth keeping when they are
library public API or a framework's convention-based export. Unused types are worth keeping in a
shared type package. An unreferenced public class member is either dead functionality or wired at
runtime, and both cases need investigating before you delete it.

When an export must stay, reach for the narrowest mechanism that expresses why, in this order:
a `@public`/`@internal`/`@beta`/`@alpha` JSDoc tag, then a `publicPackages` entry, then an `entry`
declaration, then `ignoreExports` — and only when no other mechanism can express a file-level or
export-level exception — then `@expected-unused` for a one-off intentional unused export, and an
inline `fallow-ignore-next-line` only for a one-off false positive. Generated code is excluded by
pattern, and a runtime-provided package by `ignoreDependencies`. Two properties make the keep
mechanisms auditable rather than a graveyard: `@expected-unused` is checked for staleness while the
visibility tags are not, so a tag that no longer suppresses anything is itself a finding; and a
pattern that repeats across the codebase belongs in the project config, never in a suppression
comment. Do not suppress an issue that repeats across the codebase.

The judgement the tool cannot make is whether an export is public API. Fallow sees only the
repository, so an export that external consumers import looks unused, and no amount of type-aware
analysis changes that — evidence the checker can see does not prove a published API has no external
consumers. When you cannot explain an exception in one sentence, you are using the wrong mechanism.
