---
id: agents-md-budget
title: Keep AGENTS.md within the harness's budget
when: { requires: [{ recipe: agent-guidance }] }
source: research/agent-conventions.md
enforcedBy: []
---

Keep `AGENTS.md` within the harness's budget: it is loaded in full at the start of every session.

The budgets are real and they fail differently. Codex concatenates the instruction chain from the
project root down to the working directory and stops once the combined size reaches
`project_doc_max_bytes` (32 KiB by default), so the tail of a long file is silently dropped. Claude
Code targets under 200 lines per file, loads a file of up to 4 MiB in full, and skips a larger one.
`@path` imports do not reduce the cost: imported files load at launch too, so an import is
organization, not a saving.

The remedy for hitting a cap is to split, not to grow: nested per-directory files are read
nearest-first, so a subproject's guidance belongs in that subproject's file. The root file holds
only what changes behaviour every session — the gate table and a one-line pointer — with everything
else behind the pointer.

The plan warns when the rendered block alone reaches either budget, because the block is a section
of a file that also carries the repo's own content. The warning is a signal, not a gate: a repo
whose `AGENTS.md` predates the block must not fail closed.
