# `plan.mjs` — output schema and evaluation rules

`node scripts/plan.mjs [projectDir] [--recipe <id>] [--force] [--diff [path]]` runs the detector
(`detect.mjs`) and prints the plan the agent shows for approval. Zero dependencies, node builtins
only, no package manager invoked, **writes nothing**. Exit 0 on a report; exit 1 with a message on
stderr when the detector fails or no usable recipe remains.

`DETECT-SCHEMA.md` is the JSON it consumes; `RECIPE-CONTRACT.md` is the frontmatter and the
substitution keys it renders. This file is the contract for the plan text.

## Options

| Option | Effect |
|---|---|
| `[projectDir]` | the project to plan for (default `.`) |
| `--recipe <id>` | narrow the selection to one recipe. `when` is never bypassed: an id that is not selected, or one that `requires` another recipe, plans nothing. `conflicts` still surface. |
| `--force` | overrides a **collision** only (the tool collisions in section 5), never a failed `when`. |
| `--diff` | print unified diffs for every file, not only the merge/patch/collision ones. |
| `--diff <path>` | print only the file at `<path>` and its diff. |

## Entry states

The first line after the title is the state:

| State | Output |
|---|---|
| a plan exists | `**Plan ready** — N recipe(s) selected.` then the sections below |
| already set up | `**Already set up** — N recipe(s) applied, every file intact.` (a manifest is present and every selected recipe is `intact`) |
| nothing applies (`selection: []`) | `**Nothing applies.**` then each recipe's first failing `reason.detail`; when the blocking reason is the package-manager allowlist, the fix is named — `Run \`bun install\` (or add a \`packageManager\` field to package.json), then re-run.` when no manager is detected, or `package manager \`<name>\` is not covered by any recipe` when one is detected but off the allowlist |
| unsupported (no TypeScript) | `Unsupported: no TypeScript detected. Nothing to plan.` and stop |
| detector hard error | the detector's stderr on stderr, exit 1 |
| a malformed recipe | one `{ id, error }` line per broken file in **Warnings**, the rest planned; exit 1 only when no usable recipe remains |

## Sections (fixed order)

1. **Stack** — languages (with strictness and its source), package manager (with its evidence), and
   the workspace kind and members.
2. **Selection** — the selected recipes, priority order, each with title, purpose, and cost
   (`heavy` is flagged `⚠ slow verify`).
3. **Not selected** — every usable recipe that is not selected, with its first failing
   `reason.detail` (or `applicable — not selected (narrowed by --recipe)` under `--recipe`).
4. **Held back** — the detector's `heldBack`, with its reason.
5. **Collisions** — the detector's `collisions` for the selected recipes, each with its evidence;
   `--force` marks them overridden.
6. **Files (phase 1 — writes, priority order)** — every file to be written: `path (action, scope) — verdict`.
   A `merge`/`patch`/collision shows its unified diff inline; a `create` is `new` / `no-op` / `drift`.
   `--diff` adds the rest.
7. **Commands (phase 2 — commands, priority order)** — the selected recipes' `commands` with
   `showInPlan !== false`, in selection order: `N. [<recipe>] \`<run>\` (<scope> → <dirs>)`.
8. **Gates and verify (phase 3 — verify, priority order)** — per selected recipe, its `gates` and its
   `verify` entries: `- gate \`<id>\` (<scope> → <dirs>)` (or the literal `run` in place of the gate).
9. **Warnings** — one `{ id, error }` line per unreadable recipe (or unreadable template).
10. **Drift (manifest)** — the per-recipe state from the manifest, or a degraded note.

`<dirs>` is the scope resolved to the directories the entry runs in (RECIPE-CONTRACT.md → Scope
resolution): `.` for `root`, and for `member`/`each-member` the member paths — or `.` in a single
workspace, where the scope collapses to one implicit member at the root. The plan prints the
resolution so the agent never re-derives it; an `each-member` entry that resolved to zero
directories would run zero times and record the recipe as applied without its gate ever executing.

The plan closes with the approval line, which states the three-phase apply order: *phase 1 writes
every file, phase 2 runs every command, phase 3 runs every verify* (RECIPE-CONTRACT.md → Apply
order). The selection is never applied one recipe at a time: a formatter's one-time sweep (a
`commands` entry) runs after every later recipe's JSON merges, so the sweep sorts the merged files
and that recipe's own `format:check` verify passes on the state the run just produced.

## Verdicts

Without a manifest, from the filesystem alone:

| Action | Verdicts |
|---|---|
| `create` | `new` (absent) · `no-op` (byte-identical) · `drift` (present, different) |
| `merge` (markers) | `new` (no block) · `no-op` (identical block) · `replace` (different block) |
| `merge` (JSON) | `new` (absent) · `add` (missing keys) · `no-op` · `collision` (an existing value would change) |
| `patch` | `new` (absent) · `patch` (always shown; the detector cannot verify it) |

With a manifest (`.code-quality.json`, schemaVersion 1), per file: `intact` · `update` (untouched
since apply, the library's render changed) · `drifted` (hand-edited since apply) · `missing`
(absent, or the recipe's own block/leaves are gone). Per recipe the worst file verdict wins; a
recipe the manifest does not know is `new`, one the library no longer selects is `stale`, one the
user declined is `declined`. A manifest that is absent, corrupt, or from another `schemaVersion`
degrades the report to "compare against the current library only" and nothing breaks.

## The manifest hash convention

The manifest is written by the apply step (agent-driven; there is no `apply.mjs`), one recipe at a
time after that recipe's `verify` passed. `plan.mjs` only reads it. For the drift report to agree,
the apply step MUST hash the content the recipe **owns** in each file, with the same normalization
`plan.mjs` uses:

- `create` — the whole rendered file.
- `merge` (markers) — the marker-delimited block, with trailing newlines stripped.
- `merge` (JSON) — the fragment's named leaves, canonicalized with `JSON.stringify`.

The hash is `sha256(content).slice(0, 8)` (8 hex chars, the shape the schema shows). `recipes[].recipeHash`
covers the recipe `.md` plus the content it owns in each file, so a template-only change moves it.

## Substitution

`plan.mjs` renders the two contract keys from the **whole selection**, not from the recipe that
names them:

- `{{plan.gates}}` — one Markdown table (`Gate | Command | What it checks`) of every selected
  recipe's gates, or `_No gates wired._`.
- `{{plan.details}}` — one `### <title>` section per selected recipe: its purpose, its gates, and
  its `## Undo` bullets.
- `{{plan.areas}}` — the `AREA_CONFIGS` literal: `[["", "stryker.conf.mjs"]]` in a single repo, or
  that catch-all plus one `[<member>/, <member>/stryker.conf.mjs]` per member, one entry per line,
  two-space indented with a trailing comma.
- `{{root}}` — the per-file token: the member's relative path back to the workspace root (`.` for a
  root-scoped file), taken from `stack.workspace.members[].rootPrefix`.
