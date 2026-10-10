# Recipe contract

A **recipe** is one Markdown file at `references/recipes/<id>.md`: YAML frontmatter that `scripts/detect.mjs` reads, plus a body the agent executes. This file is the single source of truth for both halves. `detect.mjs` MUST reject a recipe that breaks a **frontmatter** rule here. A rule about a *template's contents* — the `{{root}}` scoping rule below is the only one — is enforced at review time instead, because the detector reads frontmatter and never opens a template. The cheap detector check for the day it does: open each `files[]` entry's template and refuse `{{root}}` in a `root`-scoped entry.

The library is language-agnostic; a recipe is language-specific. Everything below is the shape every language's recipes share.

## Frontmatter

```yaml
---
id: biome-assist
title: Biome format and assist, wired to pre-commit
purpose: Format and sort TypeScript with Biome (linter off), applied to staged files on commit.
when:
  language: [typescript]                 # default: any
  packageManager: [bun]                  # default: any
  workspace: any                         # any | single | workspace (default: any)
  requires: [{ file: package.json }]     # ALL must hold (default: [])
  excludes: [{ file: .prettierrc }]      # ANY present => not applicable (default: [])
conflicts:
  recipes: [eslint-prettier]             # default: []
  tools: [prettier, eslint]              # default: []
cost: fast                               # fast | heavy (default: fast)
priority: 50                             # higher applies first (default: 0)
files: [...]                             # templates to write
commands: [...]                          # what the skill runs while applying
gates: [...]                             # what the project runs afterwards
verify: [...]                            # how the recipe proves itself
---
```

### Identity

| Field | Rule |
|---|---|
| `id` | `^[a-z][a-z0-9-]*$`, MUST equal the filename stem. Unique across the library. |
| `title` | Short human title. Used in the plan and in the guidance doc. |
| `purpose` | One line: what it installs and why. Used in the plan and the guidance doc. |

### `when` — machine-checkable applicability

Every condition is evaluated against the detector's stack report. All of `requires` must hold and none of `excludes` may; the list fields (`language`, `packageManager`) are allowlists that match if any member matches; `workspace` compares to the detected workspace kind.

| Predicate | Meaning |
|---|---|
| `{ file: <path> }` | `<path>` exists at the workspace root |
| `{ dep: <name> }` | `<name>` is in a detected manifest's dependencies or devDependencies |
| `{ script: <name> }` | `<name>` is a script in the root `package.json` |
| `{ recipe: <id> }` | another recipe with that `id` is selected in the same run |
| `{ recipe: "*" }` | at least one *other* recipe is selected |

A recipe with no `when` keys applies to every stack. Prose judgement belongs here as a predicate or not at all: the detector never reads the body to decide applicability.

### `conflicts` — what must not be applied alongside

- `recipes`: ids that must not both be selected. If both match, the plan keeps the higher `priority` one and reports the other as *held back*.
- `tools`: pre-existing tools (detected as a dependency or a config file **in the project**) that must not coexist with this recipe. A match does not silently drop the recipe: the plan surfaces the collision and requires an explicit override before applying. A binary on `PATH` is deliberately not evidence: it is a property of the machine, not of the project, so the same repo would collide on one developer's laptop and not in CI.

This is deliberately not `when.excludes`: `excludes` means *not applicable* (silently skipped), `conflicts` means *applicable but colliding* (loud, needs a decision).

### `cost`

`heavy` marks a recipe whose `verify` is slow (mutation testing, full-suite coverage); the plan prints a warning beside it. `fast` is silent. Weight class only, never a duration.

### `priority`

Integer. The detector sorts the selected recipes descending and applies them in that order *within each phase* (see [Apply order](#apply-order--three-phases-never-one-recipe-at-a-time)). Use it to put a recipe that documents others last (e.g. agent guidance).

## `files` — templates to write

```yaml
files:
  - path: biome.json                    # workspace-root-relative target
    action: create                      # create | merge | patch
    scope: root                         # root | member | both (default: root)
    memberMode: extends-root            # extends-root | standalone | copy (default: standalone)
    template: templates/biome-assist/biome.json   # REQUIRED, skill-relative
```

- `path` is workspace-root-relative and MUST NOT contain `..` or an absolute prefix.
- `template` is always explicit. Naming convention: mirror the target under `templates/<id>/`, minus the leading dot (`templates/biome-assist/pre-commit.block` for `.husky/pre-commit`) — a dotfile inside the skill directory is not worth the packaging risk.
- **A template MUST already satisfy every gate the whole selection installs**, not only its own recipe's. A formatter's own config that the formatter would rewrite is permanent drift from the first run; equally, a file a *different* recipe's gate checks fails that gate the moment it runs. `verify` cannot catch the second case by construction: the gate belongs to another recipe and its own `verify` ran before this recipe's files existed. The port found it twice — `scripts/mutation-gate.ts` was rejected by `require-safety-comment-for-type-assertion` (an oxlint rule, another recipe's gate) and rewritten by Biome's key sort (a third recipe's gate). Format and lint every template against the library's own gates before landing it.
- `scope`:
  - `root` — one file at the workspace root.
  - `member` — one file per workspace member.
  - `both` — a root file plus a per-member file.
- In a **single** workspace, `root`, `member` and `both` resolve to the same directory. A `member`-scoped entry is skipped when a `root`-scoped entry writes the same `path`; nothing is written twice.
- `memberMode` (only meaningful for `member`/`both`):
  - `standalone` — the member file stands alone.
  - `extends-root` — the member file is a stub that inherits the root file. Every mechanism counts: Biome `{ root: false, extends: "//" }` (the **bare string** microsyntax — `"extends": ["//"]` is resolved as a *path* and Biome refuses to load the config), tsconfig `extends`, a Stryker `import` of the base, and oxlint **spreading** the base's `rules`/`overrides` — a config reached through `extends` rejects a relative `jsPlugins` specifier, and the root base carries one, so a spread is the only inheritance oxlint allows there. Where the mechanism needs a path relative to the member (tsconfig, oxlint, a Stryker `import`), the stub names `{{root}}` — see [Substitution](#root--the-members-path-back-to-the-workspace-root).
  - `copy` — the member file is the root template verbatim.
- `action`:
  - `create` — write the rendered template when the target is absent; when present and byte-identical it is a no-op; when present and different it is drift. A drift where the repo's file carries content the template does not is a **loss** (see below).
  - `merge` — insert or replace a marker-delimited block inside an existing file, leaving everything outside the markers untouched. The marker lines are the template's own lines containing `code-quality:<id>:start` and `code-quality:<id>:end`, taken verbatim; `<id>`-scoping lets several recipes merge into one file without clobbering each other. **The comment syntax is the template's choice and MUST be a valid comment in the target language**: `<!-- … -->` for Markdown and HTML, `#` for shell, YAML and TOML, `//` for JS and TS. A `.husky/pre-commit` body is executed by `sh`, where `<!--` is a redirection — the wrong choice is a syntax error at every commit, not a cosmetic one. A missing target is created from the template. For JSON targets, `merge` means *add or overwrite the leaf keys the template names, recursively, leaving the rest*; the template is a fragment, not the whole file. An object is recursed into; **an array and a scalar are leaves** — compared whole and replaced only on approval, never element- or character-merged. A leaf that would change an existing value is a collision; adding a missing leaf is not. Recursion is what lets a `package.json` fragment name `scripts.lint` without replacing the project's other scripts, and a `tsconfig.json` fragment name `compilerOptions.strict` without replacing the project's other options.
  - `patch` — a surgical edit with no marker anchor (adding one key to a config the recipe does not own). The body's `## Apply` states the exact before/after; the detector cannot verify it, so it MUST appear in the plan. A missing target is created from the template, as for `merge`. **A patch whose after-state already holds is a no-op**: the plan reports it as `no-op` and the apply writes nothing (see below).
- **A patch owns the keys its template declares, not the file.** A patch has no marker, so the recipe cannot own the whole file the way a `create` does; it owns the after-state the body states. The plan reads the keys the template declares with a format-aware reader (TOML: `[section]` headers and `key = value`, with a multi-line array joined and comments stripped) and checks each against the target. The after-state holds when every declared key is present in the target with the template's value for a **scalar**; a **collection** (array, inline table) is compared by presence only, because the repo extends it — the recipe body's `coveragePathIgnorePatterns` is the case, where the project adds its own patterns. When the after-state holds the verdict is `no-op` and the apply writes nothing; when a declared key is absent the verdict is `patch` (unverifiable, shown with its diff) and the apply performs the edit; when a scalar's value differs the verdict is also `patch`, and the drift report reads the recipe `drifted` — the repo hand-edited a value the recipe sets.
- **A merge that would change an existing value is a collision**: it is reported in the plan and applied only on approval. Adding a missing key is not.
- **A marker block the file already carries without a marker is a duplicate**: the plan reports it as `duplicate` (a distinct verdict, plus the *Pre-existing content* section) and the apply MUST NOT append it — the gate is already wired, and appending would run it twice. This is the hand-set-up repo (#35): the harness is there, the manifest is not, so the marker is absent and the block would otherwise read `new`. The block is a duplicate only when the file already carries the **whole** block (every payload line, or — for a documentation section — every gate command it names); a block that adds anything new still applies. The plan has already proven the content is present, so it renders the recipe's `verify` with the skipped block's marker grep replaced by `true` (see [`verify`](#verify--how-the-recipe-proves-itself)); the verify passes and the recipe is recorded.
- **A `create` drift where the repo's file carries content the template does not is a loss**: the plan reports it as `loss` (a distinct verdict, plus the *Losses* section) and the apply MUST NOT overwrite it without an explicit override (`--force`). A `create` target has no marker, so the skill cannot tell "the repo added content" from "the repo is behind the library" by ownership; it compares content instead. For a JSON target the comparison is structural (#42, #44): a path the repo declares and the template does not is content the template lacks — the loss; a path present in both is not lost whatever its value, because a differing value is the library moving (a version bump, a changed default), which is drift, not the repo's content. An array is compared by element, not as a leaf (#44): a repo element no template element covers is a loss, so a repo that extends an array is not overwritten, and a reordered array is not a loss; an array element's path is `<array>[<canonical element>]` (e.g. `ignorePatterns["prototype/**"]`). For any other target it is line-based: a non-blank line of the repo's file that does not appear in the template (after normalizing whitespace, the same normalization the duplicate check uses) is content the template lacks — the loss. When nothing is lost the repo is a subset (behind), the verdict is `drift`, and the overwrite drops nothing. This is the customized-config repo (#36): the repo's `biome.json` carries an extra `overrides` entry, its `.fallowrc.json` an extra `ignorePatterns` element, its CI an extra evidence-upload step — overwriting any of them silently drops that content, and the one-time formatter sweep then reformats a generated artifact the dropped override had excluded.
- **Every merged block is attributable to its recipe.** The marker line names the `<id>`, so a reader of `.husky/pre-commit` or `.gitignore` can see which recipe owns which lines and update or remove exactly that block. A recipe MUST NOT write into a shared file without markers, and MUST NOT write a block whose marker omits its id.

## Scope resolution

`commands` and `verify` entries carry a `scope` naming the directories the entry runs in. The three
values resolve the same way for both:

| Scope | Directories |
|---|---|
| `root` | the workspace root, once |
| `member`, `each-member` | once per workspace member |

**A single workspace resolves `member` and `each-member` to one implicit member at the workspace
root** — the same collapse `files` makes (see [`files`](#files--templates-to-write)). `detect.mjs`
reports `workspace.members: []` for a single-package repo, so an entry that resolved to zero
directories would run zero times and the recipe would be recorded as applied without its gate ever
executing. In a single workspace every scope therefore resolves to exactly one directory, the
workspace root (`.`).

The plan prints the resolved directory beside each entry, so the agent never re-derives it.

## `commands` — what the skill runs while applying

```yaml
commands:
  - run: bunx @biomejs/biome check --write --unsafe --linter-enabled=false .
    scope: root        # root | member | each-member
    showInPlan: true   # default true
```

- `run` is a literal command line, executed from the scope's directory (see [Scope resolution](#scope-resolution)).
- Every command runs in the **commands phase** — after every selected recipe's `files` are written, whatever the priorities (see [Apply order](#apply-order--three-phases-never-one-recipe-at-a-time)). A one-time format sweep therefore runs after the merges of every recipe in the selection, not only its own.
- These are the commands **the skill itself runs**. A command the recipe merely *writes into* a file — a pre-commit hook body, a `package.json` script — is template content, not a `command`.
- `showInPlan: false` only for a command whose effect the plan already states (e.g. an install implied by a declared dependency). Any command that touches files the recipe did not author — a first format sweep is the common case — MUST be shown.
- **A one-time sweep's scope MUST equal the gate's scope.** A repo-wide gate (`biome check .`) needs a repo-wide sweep, even though the sweep then reformats files the recipe does not own — a generated lockfile included. Narrowing the sweep to the recipe's own files would leave every pre-existing unformatted file failing the gate the recipe installs, so the recipe's own `verify` could never pass. A repo that does not want a generated file reformatted excludes it in its own config; the recipe does not own that file.
- The skill runs nothing that is not listed here.

## `gates` — what the project runs afterwards

```yaml
gates:
  - id: format-check
    run: bun run format:check
    description: Biome format and assist, linter off
  - id: test
    run: bun run test
    description: bun test with the per-file coverage floor from the baseline
    floor: coverage        # OPTIONAL — the baseline gate this gate's floor comes from
```

The project-facing commands the recipe leaves behind: what a human or agent runs to check the project. `id` is unique within the recipe. Rendered into `AGENTS.md` and the guidance doc; a recipe that only writes prose has none.

### `floor` — the gate's ratchet

A gate entry MAY declare `floor: <gate>`, naming the gate whose recorded level is the floor this gate enforces. The floor comes from one of two places:

| `floor` value | Floor source |
|---|---|
| `coverage`, `mutation`, `lint`, `typecheck` | `.code-quality-baseline.json` — the committed floor file `scripts/score.mjs --raise` writes (`scripts/SCORE-SCHEMA.md` holds its schema) |
| `fallow-health`, `fallow-dead-code` | fallow's own baseline files (`.fallow-health-baseline.json`, `.fallow-dead-code-baseline.json`), written by the fallow-audit recipe's `fallow:raise` — fallow's floors never live in the unified baseline, because each is its own format |

The declared gate MUST read its floor from that source at run time — never from a hard-coded level — and the recipe's body MUST say where the floor is read (the gate script, the config, the command). The semantics per source gate:

- **`coverage` / `mutation`** — per-file exact fractions: a file the baseline records must meet its own `{hit, found}` / `{killed, total}` fraction (cross-multiplied, never a rounded ratio); a file it does not record must meet the recorded `global` fraction. The `global` fraction over the whole project is the score view's comparison (`score.mjs`), not a gate's: a workspace member's own run aggregates the member alone, and holding it to the workspace-wide fraction would fail a member exactly at its recorded floor.
- **`lint` / `typecheck`** — one global count: the current count must not exceed the recorded count.
- **`fallow-health`** — `fallow health --baseline`: known findings pass, new findings fail. `--min-score` MUST NOT be combined with `--baseline` in one invocation — `--min-score` replaces the finding-driven exit code and silently defeats the baseline.
- **`fallow-dead-code`** — `fallow audit --dead-code-baseline`: issues the baseline records pass in changed files, new ones fail.

With **no baseline** — or a baseline whose gate was never raised — the floor falls back to the greenfield wall: 100% for coverage and mutation, 0 for lint and typecheck, and fallow's report-only mode. A repo that never raised a baseline is therefore gated exactly as before the floor existed. A gate whose floor file exists but is unreadable fails closed: a floor that cannot be read must not silently become the wall.

A gate WITHOUT `floor` is a wall at a fixed level — a formatter's zero-diff gate has no floor, and `eslint-prettier`'s `lint` gate declares none because the unified baseline's `lint` count is oxlint's diagnostic count, a different measure than an ESLint run's. `detect.mjs` MUST reject a `floor` value outside the six gates above.

## `verify` — how the recipe proves itself

```yaml
verify:
  - gate: format-check   # OR: run: <literal command>
    scope: root          # root | member | each-member
```

Each entry either **references a gate** by id (the common case: the proof *is* the gate, stated once) or carries a literal `run` for a recipe with no gate. It runs in the directory its `scope` resolves to (see [Scope resolution](#scope-resolution)) — `each-member` runs it once per member, and in a single workspace that is one implicit member at the root, so the gate always runs at least once. It runs in the **verify phase** after every command (see [Apply order](#apply-order--three-phases-never-one-recipe-at-a-time)); every entry MUST exit 0. A non-zero verify is reported as-is: it is not retried, and it does not roll back. A recipe whose verify cannot pass on a pre-existing repo is missing an apply step, not a `verify` exception.

The one case that is not a missing apply step: a gate the project must *climb* — a 100% coverage threshold, a zero-survivor mutation score. The recipe's apply step is complete and its files are correct; the project simply does not meet the gate yet. `verify` fails as-is, the recipe stays unrecorded, and the plan reports the gap, so a re-run resumes there once the project complies. The recipe's body MUST say so, and the plan MUST show the gap before applying.

The other case is a **duplicate-skipped block** (#49). When a `merge` block is a duplicate (the file already carries its content without a marker), the apply skips it, so a verify that greps for the skipped block's marker would fail even though the recipe's outcome holds. The plan has already proven the content is present (the `duplicate` verdict), so it renders that verify with the marker grep replaced by `true` — the clause is the recipe's own `grep -q "code-quality:<id>:start" <path>`, and `<path>` is the duplicate block's file, so the replacement is exact. The agent runs the verify **as the plan renders it**, not as the recipe's frontmatter states it; the recipe is then recorded. A verify that greps for a marker the plan did *not* report as a duplicate is left untouched and still fails as-is.

## Apply order — three phases, never one recipe at a time

The skill applies the selection in three phases, not by running one recipe to completion before the
next:

1. **Files** — every selected recipe's `files` entries are written, in priority order.
2. **Commands** — every selected recipe's `commands` run, in priority order.
3. **Verify** — every selected recipe's `verify` runs, in priority order; a recipe is recorded in
   the manifest after its own verify passes.

`priority` still orders the selection and the order *within* a phase, but a phase is global: no
recipe's command runs until the last selected recipe's files are written, and no verify runs until
every command has.

This is what makes a one-time formatter sweep safe. `biome-assist` installs Biome's `useSortedKeys`
/ `useSortedPackageJson` and carries the first sweep as a `commands` entry; the recipes applied
after it (`tsconfig-strict`, `oxlint-anti-slop`, `bun-test-coverage`, `stryker-mutation`) merge new
keys into `package.json`, and a JSON `merge` appends the leaves its fragment names. If the sweep ran
together with `biome-assist` — before those merges — the merged `package.json` would never be
sorted, and `biome-assist`'s own `format:check` `verify` would fail on the state the run just
produced. Under the phased order the sweep runs in the commands phase, after every recipe's files
exist, so it sorts the merged files and the verify passes.

A recipe's `## Apply` body still lists that recipe's own steps in order; the phases above order
those steps against the rest of the selection. A body that needs to point at the cross-recipe order
cites this section rather than restating it.

## The body

Three headings, in this order:

- `## Apply` — the ordered steps the agent performs, each naming the frontmatter entry it acts on. Rationale, gotchas, and the before/after of any `patch` live here. The body MUST NOT restate a `files`/`commands`/`gates`/`verify` value as its own source of truth; it points at the entry.
- `## Idempotency` — the rule that makes a re-run safe: what the recipe does when it finds its own output already present, and what it does when the output has drifted.
- `## Undo` — the exact revert, per `files` entry.

## Substitution

Templates and body may use `{{plan.<key>}}` placeholders, substituted from the detector's plan JSON. Two keys are defined here; the detector ticket fixes any others:

| Placeholder | Renders |
|---|---|
| `{{plan.gates}}` | one complete Markdown table of every selected recipe's gates, or `_No gates wired._` when the selection has none |
| `{{plan.details}}` | one Markdown section per selected recipe: `title`, `purpose`, its gates, and its undo bullets (the detector extracts the body's `## Undo` section; a recipe file is otherwise never read to render) |
| `{{plan.areas}}` | the `AREA_CONFIGS` literal for a recipe that maps directory prefixes to per-area configs: `[["", "stryker.conf.mjs"]]` in a single repo, or that catch-all plus one `[<member>/, <member>/stryker.conf.mjs]` per `stack.workspace.members` entry. **Rendered already formatted** — each entry `["<prefix>", "<config>"]`, single-line when the list holds one entry, and otherwise one entry per line, two-space indented with a trailing comma — because the file it lands in must satisfy the formatter gate the selection installs. Rendered from the detector's member list, so the mapping never drifts from the members on disk |

This is what lets a recipe whose output describes the *whole selection* — the agent-guidance recipe — stay a static template.

### `{{root}}` — the member's path back to the workspace root

A `member`-scoped template that inherits the root file (`memberMode: extends-root`) needs a specifier
relative to the member, and the member's depth is not known until the detector runs. `{{root}}` is
that specifier: the relative path from the target file's directory to the workspace root, e.g. `../..`
for `packages/a` and `../../..` for `packages/group/b`. It is a **per-file** token, not a
`{{plan.<key>}}` key: its value changes with the member the file is rendered for.

The detector reports it, so the renderer never does path arithmetic: each entry of
`stack.workspace.members` carries `rootPrefix` (the same string). For a `root`-scoped file `{{root}}`
is `.`. A template that uses `{{root}}` MUST be `member`- or `both`-scoped; a `root`-scoped template
that names it is a contract violation.

```jsonc
// templates/tsconfig-strict/tsconfig.member.json
{ "extends": "{{root}}/tsconfig.json" }
```

## Idempotency (library-wide)

- The filesystem is the source of truth. `.code-quality.json` records what was applied and is an optimization only; no recipe may depend on it.
- The manifest is committed (ADR 0002): the formatter recipes' `.gitignore` blocks no longer name `.code-quality.json`, so the project's own gates check the skill's own artifact. It is written in the canonical form `scripts/manifest.mjs` produces — keys sorted, two spaces of indent, a trailing newline — so `biome check .` is a no-op on it. The agent records each recipe through that writer, never by hand: hand-written JSON is not byte-stable, and the formatter gate the recipes install fails on it (#34).
- A recipe re-runs safely: `create` is a no-op on an identical file, `merge` replaces its own marked block, `patch` re-applies to the same before-state — and is a no-op when the after-state already holds (see [`files`](#files--templates-to-write)).
- A `merge` block the file already carries without a marker is a **duplicate**: the plan reports it and the apply skips it, so a hand-set-up repo (or one set up by an earlier version) is not given a second block running the same gate. The plan renders the recipe's `verify` with the skipped block's marker grep replaced by `true`, so the recipe is recorded rather than re-run forever (#49). See [`files`](#files--templates-to-write).
- **Drift** is a target that differs from its rendered template with no marker to replace it. Drift is *reported*, never silently overwritten: the plan shows the diff and applies only on approval. A `create` drift where the repo's file carries content the template does not is a **loss**: the plan reports it and the apply skips it unless the human explicitly overrides (`--force`), so the repo's extra content survives. A skipped loss reads `loss` in the re-run drift report too, not `drifted` (#46): the manifest records the rendered template's hash for a skipped `create`, so the hash comparison alone cannot tell the repo's own content from a hand-edit of the skill's — the content comparison can. See [`files`](#files--templates-to-write).

## Reader rules for `detect.mjs`

The frontmatter stays inside a strict, dependency-free subset:

- Scalars, block maps, block sequences of maps, and flow lists/maps.
- Flow-style values are JSON with the quotes left off (`[typescript, javascript]`, `[{ file: package.json }]`); the reader quotes bare tokens before `JSON.parse`. Nothing else is allowed — no anchors, no multi-line strings, no nested block sequences.
- A frontmatter line outside that subset is a hard error, not a silent skip.
