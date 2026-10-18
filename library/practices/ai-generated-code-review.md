---
id: ai-generated-code-review
title: Test AI-generated code more thoroughly, not less
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: []
---

Review AI-generated code at least as rigorously as code a person wrote, and test it more than you
would test your own.

The failure modes are specific and they read as correct. Generated code calls an API that does not
exist, or one that exists with a different signature, because the model predicted the shape it
expected rather than the one the library has; it handles the happy path and invents a bypass for
the error path; it copies a pattern from training data that was insecure then and is insecure now.
None of that looks wrong at a glance, which is exactly why a glance is not the review.

Trust it least where the stakes are highest: security-relevant code — cryptography,
authentication, input validation — is where a plausible-looking mistake is most expensive, and it
gets expert review rather than a skim. A generated dependency that the code needs is also worth a
second look, because a model can reproduce a snippet under a license the project cannot accept, and
the provenance is the reviewer's to establish.

So the discipline is inverted from the intuition: the faster the code arrives, the more of the
verification it skipped has to be made up by tests and review. Use generation for boilerplate,
scaffolding, tests and exploration, where a mistake is cheap and visible; keep the design,
security and domain decisions — the parts where a wrong answer is expensive and invisible — under
human judgement. The test suite is the second opinion that generated code does not come with.
