# Recipe contract

A **recipe** is one Markdown file at `references/recipes/<id>.md`: YAML frontmatter that `scripts/detect.mjs` reads, plus a body the agent executes. This file is the single source of truth for both halves. `detect.mjs` MUST reject a recipe that breaks a rule here.

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

Integer. The detector sorts the selected recipes descending and applies them in that order. Use it to put a recipe that documents others last (e.g. agent guidance).

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
- **A template MUST already satisfy the gates its recipe turns on.** A formatter's own config that the formatter would rewrite is permanent drift from the first run.
- `scope`:
  - `root` — one file at the workspace root.
  - `member` — one file per workspace member.
  - `both` — a root file plus a per-member file.
- In a **single** workspace, `root`, `member` and `both` resolve to the same directory. A `member`-scoped entry is skipped when a `root`-scoped entry writes the same `path`; nothing is written twice.
- `memberMode` (only meaningful for `member`/`both`):
  - `standalone` — the member file stands alone.
  - `extends-root` — the member file is a stub that inherits the root file (Biome `{ root: false, extends: ["//"] }`, oxlint `extends`, tsconfig `extends`).
  - `copy` — the member file is the root template verbatim.
- `action`:
  - `create` — write the rendered template when the target is absent; when present and byte-identical it is a no-op; when present and different it is drift.
  - `merge` — insert or replace a marker-delimited block inside an existing file, leaving everything outside the markers untouched. The marker lines are the template's own lines containing `code-quality:<id>:start` and `code-quality:<id>:end`, taken verbatim; `<id>`-scoping lets several recipes merge into one file without clobbering each other. **The comment syntax is the template's choice and MUST be a valid comment in the target language**: `<!-- … -->` for Markdown and HTML, `#` for shell, YAML and TOML, `//` for JS and TS. A `.husky/pre-commit` body is executed by `sh`, where `<!--` is a redirection — the wrong choice is a syntax error at every commit, not a cosmetic one. A missing target is created from the template. For JSON targets, `merge` means *add or overwrite the leaf keys the template names, recursively, leaving the rest*; the template is a fragment, not the whole file. A leaf that would change an existing value is a collision; adding a missing leaf is not. Recursion is what lets a `package.json` fragment name `scripts.lint` without replacing the project's other scripts, and a `tsconfig.json` fragment name `compilerOptions.strict` without replacing the project's other options.
  - `patch` — a surgical edit with no marker anchor (adding one key to a config the recipe does not own). The body's `## Apply` states the exact before/after; the detector cannot verify it, so it MUST appear in the plan. A missing target is created from the template, as for `merge`.
- **A merge that would change an existing value is a collision**: it is reported in the plan and applied only on approval. Adding a missing key is not.
- **Every merged block is attributable to its recipe.** The marker line names the `<id>`, so a reader of `.husky/pre-commit` or `.gitignore` can see which recipe owns which lines and update or remove exactly that block. A recipe MUST NOT write into a shared file without markers, and MUST NOT write a block whose marker omits its id.

## `commands` — what the skill runs while applying

```yaml
commands:
  - run: bunx @biomejs/biome check --write --unsafe --linter-enabled=false .
    scope: root        # root | member | each-member
    showInPlan: true   # default true
```

- `run` is a literal command line, executed from the scope's directory. `each-member` runs it once per member.
- These are the commands **the skill itself runs**. A command the recipe merely *writes into* a file — a pre-commit hook body, a `package.json` script — is template content, not a `command`.
- `showInPlan: false` only for a command whose effect the plan already states (e.g. an install implied by a declared dependency). Any command that touches files the recipe did not author — a first format sweep is the common case — MUST be shown.
- The skill runs nothing that is not listed here.

## `gates` — what the project runs afterwards

```yaml
gates:
  - id: format-check
    run: bun run format:check
    description: Biome format and assist, linter off
```

The project-facing commands the recipe leaves behind: what a human or agent runs to check the project. `id` is unique within the recipe. Rendered into `AGENTS.md` and the guidance doc; a recipe that only writes prose has none.

## `verify` — how the recipe proves itself

```yaml
verify:
  - gate: format-check   # OR: run: <literal command>
    scope: root          # root | member | each-member
```

Each entry either **references a gate** by id (the common case: the proof *is* the gate, stated once) or carries a literal `run` for a recipe with no gate. Run once after applying; every entry MUST exit 0. A non-zero verify is reported as-is: it is not retried, and it does not roll back. A recipe whose verify cannot pass on a pre-existing repo is missing an apply step, not a `verify` exception.

The one case that is not a missing apply step: a gate the project must *climb* — a 100% coverage threshold, a zero-survivor mutation score. The recipe's apply step is complete and its files are correct; the project simply does not meet the gate yet. `verify` fails as-is, the recipe stays unrecorded, and the plan reports the gap, so a re-run resumes there once the project complies. The recipe's body MUST say so, and the plan MUST show the gap before applying.

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

This is what lets a recipe whose output describes the *whole selection* — the agent-guidance recipe — stay a static template.

## Idempotency (library-wide)

- The filesystem is the source of truth. `.code-quality.json` records what was applied and is an optimization only; no recipe may depend on it.
- A recipe re-runs safely: `create` is a no-op on an identical file, `merge` replaces its own marked block, `patch` re-applies to the same before-state.
- **Drift** is a target that differs from its rendered template with no marker to replace it. Drift is *reported*, never silently overwritten: the plan shows the diff and applies only on approval.

## Reader rules for `detect.mjs`

The frontmatter stays inside a strict, dependency-free subset:

- Scalars, block maps, block sequences of maps, and flow lists/maps.
- Flow-style values are JSON with the quotes left off (`[typescript, javascript]`, `[{ file: package.json }]`); the reader quotes bare tokens before `JSON.parse`. Nothing else is allowed — no anchors, no multi-line strings, no nested block sequences.
- A frontmatter line outside that subset is a hard error, not a silent skip.
