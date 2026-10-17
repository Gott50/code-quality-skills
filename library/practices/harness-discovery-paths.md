---
id: harness-discovery-paths
title: Put the doc where the harness looks
when: { requires: [{ recipe: agent-guidance }] }
source: research/agent-conventions.md
enforcedBy: []
---

Put the doc where the harness looks, or it is worse than missing.

A doc placed where the harness does not read it reads as done while doing nothing. A `CLAUDE.md` at
a plugin root is not project context: Claude Code does not load it, and `claude plugin validate`
warns that it is not loaded — instructions in a plugin belong in a skill. A `CLAUDE.local.md`
counts for the AGENTS.md check, so adding one to a repo that relies on `AGENTS.md` stops Claude
from reading `AGENTS.md` at all: a leftover personal file silently swaps the whole instruction set.

Discovery is nearest-wins, which is what makes the placement matter. Codex builds the chain from
the project root down to the working directory, at most one file per directory, concatenated
root-down, so the closest file takes precedence; the same layering is why a subproject's guidance
belongs in the subproject's file rather than in the root one.

Mid-session edits do not apply. A project-root file is read once at session start and held in
memory, so an edit takes effect on the next restart — a doc that is stale at session start stays
stale for the whole session.
