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
| `--force` | overrides a **collision** (the tool collisions in section 5) or a **loss** (a `create` drift that would drop the repo's extra content, section 7), never a failed `when`. |
| `--diff` | print unified diffs for every file, not only the merge/patch/collision ones. |
| `--diff <path>` | print only the file at `<path>` and its diff. |

## Entry states

The first line after the title is the state:

| State | Output |
|---|---|
| a plan exists | `**Plan ready** — N recipe(s) selected.` then the sections below; when any block is a duplicate, the line continues ` M block(s) already present — see Pre-existing content.`; when any `create` drift is a loss, it continues ` K file(s) would lose repo content — see Losses.` |
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
   A `merge`/`patch`/collision/loss shows its unified diff inline; a `create` is `new` / `no-op` /
   `drift` / `loss`. `--diff` adds the rest.
7. **Losses (create drift — the repo's extra content would be dropped)** — every `create` target the
   repo has customized (verdict `loss`), one `- \`<path>\` (<recipe>) — N key(s)/line(s) the template
   lacks:` line each followed by the lost items as `  - \`<item>\`` bullets, or `_None._`. The repo's
   file carries content the template does not, so overwriting it drops that content (#36). The agent
   MUST NOT overwrite these files without an explicit override (`--force`); `--force` marks them
   overridden (SKILL.md → Apply).
8. **Pre-existing content (duplicate blocks)** — every marker `merge` block the target file already
   carries without a marker (verdict `duplicate`), one `- \`<path>\` (<recipe>) — <evidence>` line
   each, or `_None._`. The hand-set-up repo (#35): the harness is there, the manifest is not, so the
   marker is absent and the block reads `new` while the file already runs the gate. The agent MUST
   NOT append these blocks (SKILL.md → Apply).
9. **Commands (phase 2 — commands, priority order)** — the selected recipes' `commands` with
   `showInPlan !== false`, in selection order: `N. [<recipe>] \`<run>\` (<scope> → <dirs>)`.
10. **Gates and verify (phase 3 — verify, priority order)** — per selected recipe, its `gates` and its
   `verify` entries: `- gate \`<id>\` (<scope> → <dirs>)` (or the literal `run` in place of the gate).
11. **Warnings** — one `{ id, error }` line per unreadable recipe (or unreadable template).
12. **Drift (manifest)** — the per-recipe state from the manifest, or a degraded note. The state is
   the worst file verdict (`missing` > `loss` > `drifted` > `update` > `intact`), so a recipe whose
   only non-intact file is a skipped `create` loss reads `loss`, not `drifted` (#46).

`<dirs>` is the scope resolved to the directories the entry runs in (RECIPE-CONTRACT.md → Scope
resolution): `.` for `root`, and for `member`/`each-member` the member paths — or `.` in a single
workspace, where the scope collapses to one implicit member at the root. The plan prints the
resolution so the agent never re-derives it; an `each-member` entry that resolved to zero
directories would run zero times and record the recipe as applied without its gate ever executing.

The plan closes with the approval line, which states the three-phase apply order: *phase 1 writes
every file, phase 2 runs every command, phase 3 runs every verify* (RECIPE-CONTRACT.md → Apply
order). When any `create` drift is a loss and `--force` is absent, the line continues ` K file(s)
would lose repo content and are NOT overwritten without \`--force\` (see Losses).` The selection is
never applied one recipe at a time: a formatter's one-time sweep (a `commands` entry) runs after
every later recipe's JSON merges, so the sweep sorts the merged files and that recipe's own
`format:check` verify passes on the state the run just produced.

## Verdicts

Without a manifest, from the filesystem alone:

| Action | Verdicts |
|---|---|
| `create` | `new` (absent) · `no-op` (byte-identical) · `drift` (present, different, the repo is a subset of the template) · `loss` (present, different, the repo carries content the template does not — see below) |
| `merge` (markers) | `new` (no block) · `no-op` (identical block) · `replace` (different block) · `duplicate` (no block, but the file already carries the block's content — see below) |
| `merge` (JSON) | `new` (absent) · `add` (missing keys) · `no-op` · `collision` (an existing value would change) |
| `patch` | `new` (absent) · `no-op` (the after-state already holds — see below) · `patch` (always shown; the detector cannot verify it) |

`loss` is a `create` target the repo has customized (#36): the repo's file carries content the
template does not, so overwriting it drops that content. A `create` target has no marker, so the
skill cannot tell "the repo added content" from "the repo is behind the library" by ownership; it
compares content instead. For a JSON target the comparison is structural (#42, #44): a path the repo
declares and the template does not is content the template lacks — the loss; a path present in both
is not lost whatever its value, because a differing value is the library moving (a version bump, a
changed default), which is drift, not the repo's content. An array is compared by element, not as a
leaf (#44): a repo element no template element covers is a loss, so a repo that extends an array is
not overwritten, and a reordered array is not a loss. An array element's path is
`<array>[<canonical element>]` (e.g. `ignorePatterns["prototype/**"]`). For any other target it is
line-based: a non-blank line of the repo's file that does not appear in the template (after
normalizing whitespace, the same normalization `duplicate` uses) is content the template lacks — the
loss. When nothing is lost the repo is a subset (behind), the verdict is `drift`, and the overwrite
drops nothing. The apply MUST NOT overwrite a `loss` without an explicit override (`--force`); the
plan shows the diff and the lost items (SKILL.md → Apply). A `create` file the manifest records as
`update` is the skill's own recorded content — the difference is the library's, not the repo's — so
it is not a loss.

`duplicate` is the hand-set-up repo (#35): the recipe's marker is absent, so the block reads `new`,
but the target file already carries what the block contributes. Two signals, both requiring the
**whole** block to be present — a partial match is not a duplicate (biome-assist's `.gitignore`
block adds `node_modules/`, already present, and `.code-quality.json`, absent, so it still applies):

- **line presence** — every non-blank payload line already appears in the file, compared after
  normalizing whitespace (a hand-written hook aligns its `||` with spaces);
- **command presence** — the payload is a documentation section (it carries a heading) and every
  gate command it names already appears in the file (a hand-written `AGENTS.md` documents the same
  gates in a different shape — bullets and arrows, not the rendered table).

The apply MUST NOT append a `duplicate` block (SKILL.md → Apply).

`no-op` on a `patch` is the after-state already holding (#37): the target declares every key the
template declares, with the template's value for a **scalar**; a **collection** (array, inline
table) is compared by presence only, because the repo extends it — the recipe body's
`coveragePathIgnorePatterns` is the case, where the project adds its own patterns. The plan reads
the keys with a format-aware reader (TOML: `[section]` headers and `key = value`, with a multi-line
array joined and comments stripped). A patch whose after-state holds is a no-op, so the plan says so
instead of showing the template as the target; a declared key that is absent, or a scalar whose
value differs, still reads `patch` and the apply performs the edit.

With a manifest (`.code-quality.json`, schemaVersion 1), per file: `intact` · `update` (untouched
since apply, the library's render changed) · `drifted` (hand-edited since apply) · `loss` (a
`create` target the repo has customized — see below) · `missing` (absent, or the recipe's own
block/leaves are gone). A marker block the file carries without a marker (a `duplicate`, above) is
`intact`, not `missing`: the content is present, the recipe just does not own it, so a re-run does
not reinstate a second block. A `patch` whose after-state holds is `intact` for the same reason —
the recipe's owned content is present, whatever the file's other content looks like. A `create`
target the repo has customized is `loss`, not `drifted` (#46): the apply skipped it, but the
manifest recorded the rendered template's hash (the apply records what it would have written, even
for a skipped file), so the hash comparison alone cannot tell the repo's own content from a
hand-edit of the skill's. The content comparison can — the repo's file carries content the template
does not — so the drift report reads `loss`, the same verdict the Files section shows. A file the
manifest records as `update` is the skill's own recorded content, so it stays `update`, not `loss`.
Per recipe the worst file verdict wins (`missing` > `loss` > `drifted` > `update` > `intact`); a
recipe the manifest does not know is `new`, one the library no longer selects is `stale`, one the
user declined is `declined`. A manifest that is absent, corrupt, or from another `schemaVersion`
degrades the report to "compare against the current library only" and nothing breaks.

## The manifest hash convention

The manifest is written by the apply step (agent-driven; there is no `apply.mjs`), one recipe at a
time after that recipe's `verify` passed. `plan.mjs` only reads it. For the drift report to agree,
the apply step MUST hash the content the recipe **owns** in each file, with the same normalization
`plan.mjs` uses:

- `create` — the whole rendered file. A `create` the apply skipped as a `loss` is recorded the same
  way — the rendered template's hash, what the apply would have written — so the drift report can
  still tell the repo's own content from a hand-edit (#46).
- `merge` (markers) — the marker-delimited block, with trailing newlines stripped.
- `merge` (JSON) — the fragment's named leaves, canonicalized with `JSON.stringify`.
- `patch` — the template's declared keys, canonicalized: sorted by dotted path, one per line, each
  rendered as `path = <value>` for a scalar and `path` alone for a collection. The value is the
  target's, normalized (whitespace collapsed, comments stripped); after the apply the after-state
  holds, so this is the template's own canonical form. Hashing the whole file would report drift on
  any unrelated edit, and hashing the values would report drift when the repo extends a collection
  the recipe only seeds — the key set is the ownership boundary, the same one a JSON `merge` draws
  with its named leaves.

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
