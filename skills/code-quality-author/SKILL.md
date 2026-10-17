---
name: code-quality-author
description: Authors a code-quality recipe or practice into a project's local library and installs it. Use when a project needs a gate the recipe library does not cover, a recipe variant for its stack, or the reference prose for a best practice no gate can fail on.
metadata:
  version: 1.0.0
---

# code-quality-author

Grow a project's local library: explore the project, rank the gaps the shared library leaves, author a recipe or a practice for the one the user picks, validate it, and install it. It writes files and installs packages; never run it unprompted.

It is the companion to `code-quality-setup` and requires it installed: it spawns that skill's `detect.mjs`, `plan.mjs`, `fetch.mjs`, `manifest.mjs` and `feedback.mjs`. Install both.

## The loop

**fetch → explore → author → validate → install → propose.** One artifact per pass.

### 0. Fetch

The shared library is not shipped with the skill: fetch it first, and read it from the cache path the fetch prints. The printed `libraryDir` is what the later steps pass as `--library`.

```
node <code-quality-setup>/scripts/fetch.mjs [--ref <sha>] [--json]
```

### 1. Explore

Rank the gaps the shared library leaves in this project and print them verbatim. Never improvise the ranking.

```
node scripts/gaps.mjs [projectDir] [--library <path>] [--json]   # default projectDir: .
```

`gaps.mjs` spawns the sibling `detect.mjs` and reads its stack report; it writes nothing. The gaps are ranked in three kinds: a tooling category the project uses that no selected recipe covers, then a recipe one `when` predicate away from applying, then a recipe that installs a gate no selected practice explains. The user picks which to author. **Nothing is written before the user approves the printed gap** — audit → propose → apply on approval.

### 2. Author

Write the artifact against the library's `RECIPE-CONTRACT.md`.

A **recipe** — a gate the project runs:

- `.code-quality/recipes/<id>.md` — the recipe, same frontmatter contract as `library/recipes/`.
- `.code-quality/templates/<id>/…` — the files its `files[].template` names.

A **practice** — reference prose for the half of a best practice no gate can fail on:

- `.code-quality/practices/<id>.md` — frontmatter `id`/`title`/`when`/`source`/`enforcedBy` plus the reference body. `enforcedBy` names the recipe whose machine-checkable half the prose explains; `source` is a project-relative path to the note it is drawn from.

The local layer mirrors the library: `recipes/` plus `templates/`, and `practices/`. The local recipes directory is the index the detector scans — there is no local `library.json`. A local artifact wins over a library one with the same `id`.

### 3. Validate

The contract and formatting check must pass before installing. Pass the same library the gap analysis read, so a practice's `enforcedBy` resolves against the merged layer:

```
node scripts/check-local.mjs [projectDir] --library <libraryDir> [--json]   # default projectDir: .
```

### 4. Install

Plan against the local library and apply on approval. The project **is** the fixture: a written-but-unapplied recipe is unproven.

```
node <code-quality-setup>/scripts/plan.mjs [projectDir] --library <libraryDir>
```

Show the plan, apply it on approval, and require the plan's gates to pass. A practice has no gate of its own: the plan writes `docs/code-quality/practices/<id>.md` and `agent-guidance` points at it. Record the recipe through the setup skill's canonical writer:

```
node <code-quality-setup>/scripts/manifest.mjs record [projectDir] --recipe <id> --recipe-hash <hash> \
  --file <path>:<action>:<hash> ...
```

### 5. Propose upstream (opt-in)

When the recipe belongs in the shared library, propose it — gated on `feedback: true` in `.code-quality.json` and the user's go-ahead:

```
node <code-quality-setup>/scripts/feedback.mjs [projectDir] --proposal .code-quality/recipes/<id>.md \
  --library <libraryDir> --rationale <text>
```

The recipe, its templates and the rationale are attached verbatim; only the stack report is redacted. Show the report first; the human files it.

## Reference

- [references/authoring.md](references/authoring.md) — the local layout, the three gap kinds, and the fields that matter when authoring a recipe or a practice.
- [scripts/GAPS-SCHEMA.md](scripts/GAPS-SCHEMA.md), [scripts/CHECK-LOCAL-SCHEMA.md](scripts/CHECK-LOCAL-SCHEMA.md) — the gap ranking's and the local check's output contracts.
- The library's `RECIPE-CONTRACT.md` (in the fetched `libraryDir`) — the recipe and practice frontmatter and body contract.
- The setup skill's [scripts/DETECT-SCHEMA.md](../code-quality-setup/scripts/DETECT-SCHEMA.md), [scripts/PLAN-SCHEMA.md](../code-quality-setup/scripts/PLAN-SCHEMA.md), [scripts/FEEDBACK-SCHEMA.md](../code-quality-setup/scripts/FEEDBACK-SCHEMA.md) — the detector, plan and feedback output contracts.
