# code-quality-skills

The source repo for `code-quality-setup`, an agent skill that audits a TypeScript project, selects the recipes that apply, and wires code-quality gates on approval. This glossary fixes the vocabulary of that skill and of the map that is charting it.

## Language

**Recipe**:
A self-contained unit of code-quality setup that declares when it applies, what it writes, and how it proves itself.
_Avoid_: rule, module, plugin, step

**Detector**:
The read-only inspector that reports a project's stack and evaluates every recipe's applicability, without writing anything.
_Avoid_: analyzer, scanner, tool

**Stack report**:
The detector's account of one project: its languages, package manager, workspace layout, and per-package tooling.
_Avoid_: inventory, profile, dump

**Selection**:
The recipes a run will apply, in application order.
_Avoid_: plan, shortlist, set — *plan* is the rendered artifact, not the choice

**Held back**:
A recipe that matched but was dropped, by a conflict with another recipe or by a requirement that no longer holds.
_Avoid_: skipped, excluded, rejected — a recipe that never matched is simply *not applicable*

**Conflict**:
A recipe's declaration that it must not be applied alongside another recipe or a tool the project already uses.
_Avoid_: clash, incompatibility

**Collision**:
A selected recipe meeting a tool the project already uses; it demands an explicit decision rather than a silent drop.
_Avoid_: conflict — a collision is the event, a conflict the declaration

**Plan**:
The approvable statement of a run: what will be written and what will be run.
_Avoid_: proposal, preview, diff

**Applied-state manifest**:
The committed record of what a run applied; an optimization, never the source of truth.
_Avoid_: lockfile, state file, cache

**Drift**:
An owned file that no longer matches what its recipe would write.
_Avoid_: divergence, desync, change

**Merge block**:
The marker-delimited region of a shared file that exactly one recipe owns.
_Avoid_: section, insert, hunk

**Gate**:
A project-facing check a recipe leaves behind for humans and agents to run.
_Avoid_: check, script, command — commands belong to the run, gates to the project

**Verify**:
A recipe's own proof, run once after it applies.
_Avoid_: test, validation, smoke

**Entry state**:
The condition a run starts from: already set up, nothing applies, unsupported project, or a detector failure.
_Avoid_: precondition, guard
