---
id: release-discipline
title: Never release without CI green on the release commit
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: [release-automation, release-automation-npm]
---

Release only from a commit whose CI run is green, and let the version and the changelog be derived
from messages that conform rather than from a judgement made at release time.

The release commit is the one commit whose correctness is the promise the version makes to everyone
downstream. A tag cut from a branch whose checks were skipped, or from a local tree that differs
from the pushed one, publishes a version nobody has verified, and the artifact cannot be unshipped.
Green on the release commit, from the same commit the tag points at, is the minimum the release
process has to check.

Derive the version rather than asserting it. Semantic versioning is a contract about compatibility,
and the signal that says which part of the number moves — a fix, a feature, a breaking change — is
already in the commit messages when they conform to a convention. Reading it from there makes the
bump a consequence of the change and the changelog a record of it, instead of two artefacts a
person reconstructs under release pressure and gets subtly wrong.

Keep the messages conforming at the point they are written. A commit-message check runs before the
message is recorded, which is the only moment the author still has the change in mind; correcting
it later means rewriting history, and a release that has to guess at the change type is one that
will eventually guess wrong. Releasing without a changelog, or with an unreadable generated one,
is the same failure from the other side — the consumers of a breaking change learn about it after
their build breaks.

The judgement is recorded in [the best-practices coverage note](../../research/best-practices-coverage.md).
