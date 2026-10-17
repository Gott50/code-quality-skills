---
id: instruction-no-op-test
title: Delete an instruction the model already obeys
when: { requires: [{ recipe: agent-guidance }] }
source: research/agent-conventions.md
enforcedBy: []
---

Delete an instruction the model already obeys by default.

An instruction the model already follows pays context load to say nothing. The test is whether it
changes behaviour versus the default, and that test is model-relative, not reader-relative: two
people disagreeing about whether a line is a no-op disagree about the default, and settle it by
running the document, not by debate. If the model does the right thing without the line, the line
is overhead.

A stale instruction is not inert. It competes for attention with the live ones, so a file that
accumulates them loses the rules that still matter — the failure is behavioural ("it keeps doing
the thing I told it not to") and silent, which is why both harnesses ship tooling for it: Claude
Code's `/doctor prompt-audit` looks for instructions written for older models and references to
files that no longer exist, and Codex rebuilds the instruction chain on every run so a restart is
the whole cache clear.

Revisit after a major model release. An instruction that worked around an older model's limitation
becomes overhead once the newer model handles the case on its own, and the only way to notice is to
re-read the file with the no-op test in hand.
