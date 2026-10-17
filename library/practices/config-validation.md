---
id: config-validation
title: Validate config at startup, and never commit environment-specific values
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: []
---

Parse the configuration into validated, typed values when the process starts, and fail fast on a
missing or malformed one; never commit a value that is specific to one environment.

Config read lazily and scattered through the code is a class of failure with no good diagnostic: an
environment variable missing in production surfaces as `undefined` at the one call site that needed
it, hours after start, in the middle of a request. Reading and validating the whole set at startup
turns that into a process that refuses to boot with a message naming the key that is wrong — the
cheapest possible moment to find it. Parse into a typed object at that point, so the rest of the
code receives a value it does not have to re-check and cannot mistype.

Keep environment-specific values out of the repository. A committed `staging` URL, a developer's
local endpoint, a default secret is a value that is correct for exactly one environment and wrong —
or dangerous — in the others. The committed file holds the shape and the non-secret defaults; the
environment supplies what differs, and a secret is never in either, because a value that must be
rotated cannot be one that requires a commit.

Validation is also what makes a config change reviewable: an unknown key, a value of the wrong
type, a missing required one is a rejected start rather than a surprise at runtime. Where a project
supports several environments, the validation runs over each of their configs in CI, so the config
that is not the one you deploy with is still checked.

The judgement is recorded in [the best-practices coverage note](../../research/best-practices-coverage.md).
