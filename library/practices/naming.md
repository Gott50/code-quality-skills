---
id: naming
title: A name says what the thing is, not that it exists
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Choose a name that states what a value is or what a function does, and never reach for `data`,
`info`, `obj`, `result`, `manager` or `handler` — those carry no information a reader did not
already have.

A generic name is a placeholder that survived. It says the author did not decide what the value
means, and it pushes that decision onto every reader, who must reconstruct the meaning from the
surrounding code each time. The name is the cheapest documentation a codebase has: `retryCount`
costs one word and saves the reader the inference that `count` would have demanded.

Match the convention of the surrounding code rather than the one you would have chosen — a codebase
with `getUser` and one with `fetchUser` are both fine, and a module that uses both is not. A name
should also describe the contract and not the implementation: `listUsers` promises a list the
implementation may not guarantee, while a name that names the return type honestly survives the
refactor that changes it.

Rename when your understanding changes, and do it as part of the change that improved it, because a
name that has drifted is worse than a generic one — it is confidently wrong. Consistency is
enforced by whatever naming rules the project turns on in its linter; the choice of which rules is
the project's, and the discipline of naming for the reader is the part no rule can decide.

Put the unit or qualifier last and order the qualifiers by descending significance, so that
`latency_ms_max` and `latency_ms_min` share a prefix and a reader scanning a column of names meets
the family before the distinction; `max_latency_ms` scatters the same information across the width
of the name and lines up with nothing. Spell names out — `count`, not `cnt`, `message`, not `msg` —
because an abbreviation is a private shorthand every reader must decode, and the characters it saves
are paid back on each read; the same rule reaches the command line, where a script's flags are
long-form (`--force`) so that the invocation is legible without a legend. Prefer a noun to an
adjective or a present participle, because a name is composed into larger names and only the noun
composes: `replica.pipeline` yields `config.pipeline_max`, while `replica.preparing` yields nothing
a reader can build on.

Order declarations so the reader meets them in the order they are needed: `main` first, and inside a
type the fields, then the types, then the methods, sorting alphabetically when no stronger order
presents itself, because a stable order lets a reader find a member by position instead of by
search. Give each name one meaning — a name that carries two context-dependent senses forces the
reader to work out which one applies from the call site, and one word doing two jobs is the
beginning of a bug that reads as correct. When a second meaning appears, it is a second name.
