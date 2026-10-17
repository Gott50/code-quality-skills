---
id: error-taxonomy
title: Classify an error before you write a handler
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: []
---

Decide what kind of error you are handling — transient or permanent, retriable or not, user-caused
or system-caused — before you write the handler, and let the classification, not the call site,
decide the response.

An unclassified error collapses into one of two bad handlers: catch everything and retry, which
re-runs a permanent failure forever, or catch everything and surface it, which drops a transient
failure the user could have been spared. The taxonomy is what tells the two apart, and it is a
property of the error rather than of where it was caught. A timeout is retriable; a 400 is not; a
500 is retriable only cautiously, with a low budget; a validation failure is the caller's to fix
and yours to report.

Classify by who can act. A user-caused error gets a structured, actionable message — a request-id,
the field that was wrong — and never the internal detail that produced it. A system-caused error is
logged with full context and, where the operation permits, degraded around; it is not decorated
into a message for the user, because there is nothing the user can do with it. A single error model
across the codebase is what makes the classification visible; two error shapes in the same service
means every handler has to guess.

The handler then reads from the classification: retry only what is retriable, within a budget and
with backoff; fail fast on what is not; and let an unknown error default to the conservative choice
— treat it as permanent and surface it — until observability says otherwise. An error that is
caught to be rethrown unchanged adds nothing and hides the catch site; an error that is caught and
swallowed silently is the case the taxonomy exists to prevent.
