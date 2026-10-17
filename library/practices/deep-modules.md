---
id: deep-modules
title: A deep module hides real work behind a simple interface
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: [fallow-audit, fallow-audit-npm]
---

Design a module as a simple interface over real functionality, and count the things a caller must
know to use it — that number is the interface, and a small one is the goal.

The interface is the cost the module imposes on every caller, and the functionality behind it is
the benefit. A module that hides a lot behind a little is deep; a module whose interface is as
complicated as the work it does is a pass-through, and a pass-through adds a name and a layer
without removing either. A `UserWrapper` that forwards to a repository and renames one field has
made the call site longer and the system no simpler.

The practical test is the count: how many things does a caller have to know, and what does the
module hide? An HTTP client that presents `get`/`post` hides connection pooling, retries and
serialization; a module that makes the caller choose a pool size, a retry count and an encoding is
handing the complexity back. When the interface is nearly identical to the layer below it, the
layer is probably not earning its place.

Pull complexity inward when it has to go one way or the other: a module that absorbs a hard case
internally is better than many callers that each handle it. This is also where the audit's
complexity gates are the only machine-checkable proxy — they can flag the module that grew, but the
judgement that the interface should have hidden the growth is a design decision, and it is this
one.

The judgement is recorded in [the best-practices coverage note](../../research/best-practices-coverage.md).
