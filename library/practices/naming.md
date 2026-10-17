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

The judgement is recorded in [the best-practices coverage note](../../research/best-practices-coverage.md).
