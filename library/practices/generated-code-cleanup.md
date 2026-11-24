---
id: generated-code-cleanup
title: Remove generated-looking code before review
when: { requires: [{ file: package.json }] }
source: research/generated-code-cleanup.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Delete the code that exists to explain itself, hedge, or narrate, before anyone reviews the diff.

Generated code arrives with a particular residue: comments that restate the next line, JSDoc that
repeats the name, defensive checks the types already rule out, helpers with one caller, options
nobody passes, and prose that sells. None of it is wrong in the way a test catches; all of it is
wrong in the way a reviewer pays for. The diff is the unit — clean it before review, not after,
because a reviewer who has to separate signal from residue reviews less of the signal.

Start with the comments. A comment that says what the next line does is a second copy of the line,
and the copy is the one that goes stale; if the line is unclear without it, rename something. JSDoc
that repeats the name (`/** The value. */ value`) says nothing the signature does not. A section
banner (`// ---- Helpers ----`) marks a boundary the file's structure should already show. A comment
that narrates history or the task — "now we", "updated to", "fixed the bug where", "as requested" —
is a commit message that escaped into the source; git holds it. What stays is the reason: the
constraint, the upstream quirk, the invariant a caller must preserve, in three lines at most.

Then the code the types already made impossible. `if (!items) return` on `items: Item[]`, `?? []` on
a value that is never undefined, a `try` around code that cannot throw — each is a branch no input
reaches, and each one has to be read and tested as if it could. Narrow `unknown` at the boundary
instead of defending against it everywhere. A cast or `!` with no stated reason is the same defect in
the other direction: it asserts what the compiler cannot check and leaves the reader no way to check
it either.

Then the structure that only exists because it was easier to write than to remove. A helper with one
caller, or a wrapper that only renames its argument, adds a hop without adding a name that explains
anything; inline it. An option, parameter, or config object nobody passes is a branch that will never
be exercised and a decision the next reader has to make. A name that says nothing — `data`, `result`,
`temp`, `flag`, `item2` — pushes the reader into the body to find out what it is.

The prose has the same problem. Hedges and sales words — "robust", "seamless", "comprehensive",
"simply", "just", "easily", "ensure", "leverage", "utilize", "note that" — are claims the code does
not make and the reviewer cannot check; cut the word, and if the sentence no longer means anything,
cut the sentence. Logs, probes, and commented-out code are debris from the session that produced the
file: delete them, because version control already has the version that worked.

Examples are the strictest case: a code example carries no comments at all, only the directives a
tool needs to read it (`svelte-ignore`, `eslint-disable`, `@__PURE__`). An example is read as the
shape of correct usage, and a comment in it teaches the reader that commentary is part of the shape.

The machine can see part of this. The anti-slop gate fails on an assertion with no stated reason and
on a `@ts-ignore`-style directive; the rest — whether a helper earns its name, whether a sentence
sells, whether a branch is reachable — is the reviewer's judgement, which is why this is a practice
and not a rule.
