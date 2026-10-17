---
id: snapshot-review
title: Review a snapshot diff before you update it
when: { requires: [{ testFile: true }] }
source: research/best-practices-coverage.md
enforcedBy: []
---

Read every line of a snapshot diff and decide it is correct before you accept it; never update a
snapshot blindly.

A snapshot is an assertion whose expected value is whatever the code last produced. That is its
strength — it captures a large structured output no hand-written assertion would spell out — and
its hazard: an update command re-records whatever the code now emits, including the bug. The
command is not a fix; it is the same act as editing an `expect` to match a wrong result, only
faster and easier to run without looking.

So the review is the assertion. Run the diff, read what changed, and ask whether the new output is
the output you intended; only then accept it. A snapshot updated in the same commit as the change
that produced it, with the diff explained, is reviewable evidence. A block of snapshots updated
after an unrelated refactor, with the message "update snapshots", is a change nobody has read.

Keep snapshots for output that is large, structured, and stable in shape — generated code, API
payloads, CLI output — and test the behaviour with ordinary assertions where a value is what
matters. A snapshot over an unstable structure fails on every formatting change, and the churn
trains the reviewer to accept the diff without reading it, which is the failure mode the practice
exists to prevent.
