---
id: structured-logging
title: Log key-value events, never PII
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: []
---

Emit each log line as a structured event — a level, a stable event name, and named key-value fields
— and never put personal or secret data in a log.

A free-text message is readable once and unqueryable forever. Once the line is a JSON object with
named fields, "every failed payment in the last hour for one tenant" is a query instead of a grep;
the fields are what an aggregator indexes, and a message assembled by string interpolation throws
that away at the moment it costs the least to keep. Pick the field names and keep them stable —
a renamed field is a broken dashboard, and the cost of that is paid by whoever is on call.

Level is a decision, not a habit. `ERROR` is for a failure that needs a human; an expected
condition logged at `ERROR` trains the reader to ignore the level, and a noisy level is the same as
no level. `WARN` is for the unexpected but recoverable — a retry, a fallback, a near-limit — and
`INFO` for the state changes worth keeping in normal operation.

Never log PII, credentials, or full payloads. A log is copied to a third party, retained, and read
by people who are not cleared for the data; redacting a field at write time is cheap, and removing
it from an aggregator after the fact is not. Log decisions, state changes, and errors — the
identity of a record by its id, not the record itself.
