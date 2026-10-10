# `plan.mjs` — output schema and evaluation rules

`node scripts/plan.mjs [projectDir] [--recipe <id>] [--force] [--diff [path]] [--check]` runs the
detector (`detect.mjs`) and prints the plan the agent shows for approval. Zero dependencies, node
builtins only, no package manager invoked, **writes nothing and runs no gate**. It reads the gate
artifacts that already exist for the **Measurement** section (the adoption flow's measure step, see
below) — reading is not writing, and the heavy gates run in the apply, not here. Exit 0 on a report;
exit 1 with a message on stderr when the detector fails or no usable recipe remains. `--check` prints
the machine-readable drift report instead of the plan and exits 0 only when it is clean (see below).

`DETECT-SCHEMA.md` is the JSON it consumes; `RECIPE-CONTRACT.md` is the frontmatter and the
substitution keys it renders. This file is the contract for the plan text.

## Options

| Option | Effect |
|---|---|
| `[projectDir]` | the project to plan for (default `.`) |
| `--recipe <id>` | narrow the selection to one recipe. `when` is never bypassed: an id that is not selected, or one that `requires` another recipe, plans nothing. `conflicts` still surface. |
| `--force` | overrides a **collision** (the tool collisions in section 6) or a **loss** (a `create` drift that would drop the repo's extra content, section 8), never a failed `when` and never an **update** (a `create` drift the apply merges, section 9). |
| `--diff` | print unified diffs for every file, not only the merge/patch/collision ones. |
| `--diff <path>` | print only the file at `<path>` and its diff. |
| `--check` | print the machine-readable drift report (one JSON document) instead of the plan, and exit 0 only when it is clean. See `--check` below. |

## `--check`: the machine-readable drift report

`--check` turns the plan into the drift report a CI job consumes (#52). It prints **one JSON
document** to stdout instead of the plan text, and exits 0 only when the report is clean. It is a
pure addition: without the flag the output and the exit codes are unchanged.

```json
{
  "clean": false,
  "manifestPresent": true,
  "degraded": false,
  "degradedReason": null,
  "recipes": [
    { "id": "biome-assist", "state": "intact" },
    { "id": "oxlint-anti-slop", "state": "drifted" }
  ],
  "markdown": "## Drift (manifest)\n\nbiome-assist: intact, oxlint-anti-slop: drifted"
}
```

| Field | Meaning |
|---|---|
| `clean` | the report is clean: a manifest is present and no recipe has drifted (see the exit code below) |
| `manifestPresent` | a readable `.code-quality.json` of the current `schemaVersion` was found |
| `degraded` | the manifest is absent, corrupt, or from another `schemaVersion`; the report compares against the current library only |
| `degradedReason` | why the report is degraded — `no manifest`, `manifest is not valid JSON`, or `manifest schemaVersion N ≠ 1` — or `null` |
| `recipes` | the per-recipe verdicts, in the same order and with the same `id`/`state` the `## Drift (manifest)` section prints; `[]` when degraded |
| `markdown` | the exact `## Drift (manifest)` section text — the same string `renderPlan` emits — so the consumer posts it verbatim |

`markdown` is the section the plan prints, byte for byte: the heading, a blank line, then the
`<id>: <state>` list (or the degraded note). The consumer (the `ci-drift` workflow, #54) posts it
without re-deriving anything from the other fields.

### The exit code

`--check` exits **0** when `clean` is true and **1** otherwise. `clean` is "the report is clean": a
manifest is present and no recipe state is a drift state. Drift is the repo's own content diverging
from what the skill recorded:

| State | Drift? | Why |
|---|---|---|
| `drifted` | yes | the repo hand-edited a file the recipe owns |
| `missing` | yes | the repo deleted a file the recipe owns |
| `loss` | yes | a `create` target the repo customized — the recipe's content is not there |
| `new` | no | a selected recipe never applied: the repo may be mid-setup, or the library grew a recipe. Not the repo's content diverging |
| `declined` | no | the user declined the recipe; a deliberate state, not drift |
| `update` | no | the library's render moved; the repo's file is untouched (SKILL.md → Re-run) |
| `stale` | no | the library dropped a recorded recipe; the repo's content is not known to have diverged |

`clean` is deliberately not the plan's "Already set up" condition (a manifest present and every
recipe `intact`): a repo mid-setup, or one the library grew a recipe for, has `new` recipes and is
not drifting, so the CI job must not flag it.

A degraded report is **not** clean: the check cannot establish that the repo is as the skill left
it, and a false "clean" is worse than a false "dirty". The JSON's `degraded`/`degradedReason` and
the `markdown` degraded note say why. The `ci-drift` workflow ignores the exit code (the job is
non-blocking); the code is for a script that gates on the report.

`--check` composes with the other flags: the report reflects the plan those flags produce (`--recipe`
narrows the selection, so the report covers the narrowed set). The unsupported (no TypeScript) and
detector-failure paths keep their existing stdout/stderr and exit codes — a consumer MUST treat
stdout that is not the JSON document as "no report".

## Entry states

The first line after the title is the state:

| State | Output |
|---|---|
| a plan exists | `**Plan ready** — N recipe(s) selected.` then the sections below; when any block is a duplicate, the line continues ` M block(s) already present — see Pre-existing content.`; when any `create` drift is a loss, it continues ` K file(s) would lose repo content — see Losses.`; when any `create` drift is an update, it continues ` U file(s) carry repo additions — see Updates.` |
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
3. **Measurement (the floor the apply will install)** — one row per gate the selection will install
   (a selected recipe's gate that declares `floor`): the gate, the level it measures now, the floor
   the apply will install (the recorded floor when the gate has one, else the measured level, else
   the wall), whether the apply raises or keeps it, and the floor's source (`unified` or `fallow`).
   See below.
4. **Not selected** — every usable recipe that is not selected, with its first failing
   `reason.detail` (or `applicable — not selected (narrowed by --recipe)` under `--recipe`).
5. **Held back** — the detector's `heldBack`, with its reason.
6. **Collisions** — the detector's `collisions` for the selected recipes, each with its evidence;
   `--force` marks them overridden.
7. **Files (phase 1 — writes, priority order)** — every file to be written: `path (action, scope) — verdict`.
   A `merge`/`patch`/collision/loss/update shows its unified diff inline; a `create` is `new` /
   `no-op` / `drift` / `update` / `loss`. `--diff` adds the rest.
8. **Losses (create drift — the repo's extra content would be dropped)** — every `create` target the
   repo has customized (verdict `loss`), one `- \`<path>\` (<recipe>) — N key(s)/line(s) the template
   lacks:` line each followed by the lost items as `  - \`<item>\`` bullets, or `_None._`. The repo's
   file carries content the template does not, so overwriting it drops that content (#36). The agent
   MUST NOT overwrite these files without an explicit override (`--force`); `--force` marks them
   overridden (SKILL.md → Apply).
9. **Updates (create drift — the library's content is merged in, the repo's additions kept)** — every
   `create` target the repo has extended with **no manifest** (verdict `update`), one
   `- \`<path>\` (<recipe>) — N key(s)/line(s) the template lacks:` line each followed by the
   additions as `  - \`<item>\`` bullets. The section is rendered **only when there is an update**, so
   a repo with a manifest — where the same file reads `loss` — is unchanged. The repo's file carries
   content the template does not, but with no manifest the plan cannot tell the repo's own additions
   from the skill's own earlier install; the filesystem is the source of truth (ADR 0001), so the
   verdict is `update`: the library's content is the target and the repo's additions are preserved by
   a merge (#90). The agent writes the library's content and re-applies the additions — it MUST NOT
   overwrite the file verbatim (that drops them) and MUST NOT skip it (that leaves the gate
   uninstalled). No `--force` is needed (SKILL.md → Apply).
10. **Pre-existing content (duplicate blocks)** — every marker `merge` block the target file already
   carries without a marker (verdict `duplicate`), one `- \`<path>\` (<recipe>) — <evidence>` line
   each, or `_None._`. The hand-set-up repo (#35): the harness is there, the manifest is not, so the
   marker is absent and the block reads `new` while the file already runs the gate. The agent MUST
   NOT append these blocks (SKILL.md → Apply).
11. **Commands (phase 2 — commands, priority order)** — the selected recipes' `commands` with
   `showInPlan !== false`, in selection order: `N. [<recipe>] \`<run>\` (<scope> → <dirs>)`.
12. **Gates and verify (phase 3 — verify, priority order)** — per selected recipe, its `gates` and its
   `verify` entries: `- gate \`<id>\` (<scope> → <dirs>)` (or the literal `run` in place of the gate).
   A literal `run` that greps for a skipped duplicate block's marker is rendered with that grep
   replaced by `true` (#49): the plan has already proven the block's content is present (the
   `duplicate` verdict), so the verify passes and the recipe is recorded. The agent runs the verify
   **as rendered**, not as the recipe's frontmatter states it (RECIPE-CONTRACT.md → `verify`).
13. **Warnings** — one `{ id, error }` line per unreadable recipe (or unreadable template).
14. **Drift (manifest)** — the per-recipe state from the manifest, or a degraded note. The state is
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

## The measurement — the floor the apply will install

The **Measurement** section is the adoption flow (#67): for every gate the selection will install (a
selected recipe's gate that declares `floor`), it shows the level the gate measures **now** and the
floor the apply will install. A gate with no recorded floor is raised to its measured level, so the
gates are green on day one and can only improve. Greenfield is the same code path: a clean repo
measures 100% (or 0), so the floor is the wall — one path, not two.

```
## Measurement (the floor the apply will install)

_The apply installs each gate with its floor at the measured level, so the gates are green on day one and can only improve. A gate that already has a recorded floor keeps it — the apply does not re-raise it, and a measured level below it is a regression. The floor never rises on its own: only `score.mjs --raise` (or the improvement skill) raises it._

| Gate | Measured now | Floor the apply installs | Apply | Source |
|---|---|---|---|---|
| `lint` | 0 | 0 | keep | unified |
| `typecheck` | 0 | 0 | keep | unified |
| `coverage` | functions 50.0% (3/6)  lines 56.7% (34/60) | functions 83.3% (5/6)  lines 80.0% (48/60) ⚠ regression | keep | unified |
| `mutation` | _unmeasured_ | 100% | raise | unified |
| `fallow-dead-code` | 1 | recorded | keep | fallow |
| `fallow-health` | 93.3 (A) | 93.3 (A) | raise | fallow |
```

| Column | Meaning |
|---|---|
| Gate | the `floor` value the selected recipe's gate declares — `coverage`, `mutation`, `lint`, `typecheck`, `fallow-health`, `fallow-dead-code` |
| Measured now | the level the gate's artifact carries, read by `scripts/score.mjs`'s readers (the same ones the score view uses); `_unmeasured_` when the artifact is absent, `⚠ stale` when the artifact is older than the newest source file |
| Floor the apply installs | the **recorded** floor when the gate already has one (the unified baseline for coverage/mutation/lint/typecheck, fallow's own file for the two fallow gates — shown as `recorded`), else the measured level, else the greenfield wall when unmeasured: 100% for coverage and mutation, 0 for lint and typecheck, fallow's report-only mode. `⚠ regression` when the measured level is below the recorded floor |
| Apply | `keep` — the gate already has a recorded floor, so the apply does not re-raise it; `raise` — no recorded floor, so the apply writes the measured level |
| Source | `unified` (`.code-quality-baseline.json`) or `fallow` (fallow's own baseline files) |

The plan **writes nothing and runs no gate**: it reads the artifacts and the baseline that already
exist. This is the resolution of the tension between "the plan writes nothing" and "measuring needs
the gate artifacts": the plan measures from whatever artifacts are on disk, and the apply produces
the authoritative measurement by running the gates. The plan never runs the heavy gates (Stryker
takes minutes); the apply does, once, in the capture step before the baseline write.

A **stale** artifact (older than the newest source file, skipping `node_modules`, dot-directories and
the artifact directories themselves) is flagged, not trusted: the level shown is not the level of
the code as it stands. The apply re-runs the gate before `score.mjs --raise`, so a stale artifact
never becomes a floor — the recorded floor is always the level the apply just measured.

The floor never rises on its own. The gates are read-only checks; only `score.mjs --raise` (or the
improvement skill) raises a floor. A repo that already has a baseline is unchanged: the plan shows
the recorded floor as the floor the apply installs, the apply does not re-raise it, and `--raise`
merges (the floor never falls — see `SCORE-SCHEMA.md` → The adoption flow's measure step).

## Verdicts

Without a manifest, from the filesystem alone:

| Action | Verdicts |
|---|---|
| `create` | `new` (absent) · `no-op` (byte-identical) · `drift` (present, different, the repo is a subset of the template) · `update` (present, different, the repo carries content the template does not, **no manifest** — see below) · `loss` (present, different, the repo carries content the template does not, **manifest present** — see below) |
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
but the target file already carries what the block contributes. Three signals — the first two require
the **whole** block to be present, so a partial match is not a duplicate (repo-hygiene's `.gitignore`
block adds `.npm/`, `dist/`, `*.tsbuildinfo`, `.env`, `.env.local` and `*.log`; a repo that already
ignores `dist/` but not the rest is a partial match, so the block still applies):

- **line presence** — every non-blank payload line already appears in the file, compared after
  normalizing whitespace (a hand-written hook aligns its `||` with spaces);
- **command presence** — the payload is a documentation section (it carries a heading) and every
  gate command it names already appears in the file (a hand-written `AGENTS.md` documents the same
  gates in a different shape — bullets and arrows, not the rendered table);
- **equivalent command** (#94) — the payload's gate command is already run by the file under a
  different command. A repo that wired the same gate itself — its own `scripts/biome-staged.ts`
  behind `bun run biome:staged` — runs Biome's staged format, but the line is not the block's line,
  so line presence misses it and the block would be appended, running the gate twice. The block's
  gate command names a tool (`bunx @biomejs/biome check --staged …`); the file already runs the gate
  when it names the same tool binary and the same mode word. Both must match, so a repo that runs
  the tool in another mode (`biome:lint`) is not a duplicate.

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
A `create` the apply left as a **merge** (#90) is `intact`, not `update`: the apply recorded the file
it wrote (the library's content plus the repo's additions — see the hash convention below), so the
recorded hash matches the file and the file still carries every path/line the current template owns.
The recipe's owned content is present and the extras are the repo's, so a re-run must not overwrite
the file with the bare template. An old manifest recorded the bare template's hash, so the recorded
hash does not match the merged file and this branch never fires for it.
Per recipe the worst file verdict wins (`missing` > `loss` > `drifted` > `update` > `intact`); a
recipe the manifest does not know is `new`, one the library no longer selects is `stale`, one the
user declined is `declined`. A manifest that is absent, corrupt, or from another `schemaVersion`
degrades the report to "compare against the current library only" and nothing breaks.

## The manifest hash convention

The manifest is written by the apply step (agent-driven; there is no `apply.mjs`), one recipe at a
time after that recipe's `verify` passed. `plan.mjs` only reads it. The apply step MUST write it
through `scripts/manifest.mjs`, the canonical writer — never by hand. The manifest is a committed
file (ADR 0002), so it must be in the one form the formatter recipes' `biome check .` leaves alone:
**keys sorted, two spaces of indent, a trailing newline**. The writer emits exactly that, and it is
idempotent — re-recording a recipe whose content is unchanged rewrites the same bytes — so the
manifest is byte-stable across runs. Hand-written JSON is not byte-stable, and the formatter gate
the recipes install fails on it (#34).

The manifest also carries the opt-in `feedback` flag (#71): a top-level boolean, absent = off, set
by `node scripts/manifest.mjs feedback [projectDir] --enable` and removed by `--disable`. It is not
part of the drift comparison — see [FEEDBACK-SCHEMA.md](FEEDBACK-SCHEMA.md).

For the drift report to agree, the apply step MUST hash the content the recipe **owns** in each
file, with the same normalization `plan.mjs` uses:

- `create` — the whole rendered file. A `create` the apply skipped as a `loss` is recorded the same
  way — the rendered template's hash, what the apply would have written — so the drift report can
  still tell the repo's own content from a hand-edit (#46). A `create` the apply left as a **merge**
  (the `update` verdict, #90) records **the file the apply wrote** — the library's content plus the
  repo's additions — not the bare template: the next run then reads `intact` (the recorded file still
  carries every path/line the current template owns, so the recipe's owned content is present and the
  extras are the repo's), instead of `loss` forever (the bare template's hash never matches the
  merged file) or `update` (which would overwrite the file with the bare template and drop the
  additions).
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
