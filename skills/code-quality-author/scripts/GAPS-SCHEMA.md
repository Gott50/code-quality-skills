# `gaps.mjs` — output schema and gap rules

`node scripts/gaps.mjs [projectDir] [--library <path>] [--json]` spawns the sibling
`code-quality-setup` skill's `detect.mjs`, reads its report, and prints the ranked gaps the
authoring skill acts on. Zero dependencies, node builtins only, no package manager invoked. Exit 0
on a gap list (a gap is not an error), exit 1 only on a detector hard error or a bad flag.

This file is the contract between the gap analysis and the authoring skill's prose. The detector's
own output is specified in `skills/code-quality-setup/scripts/DETECT-SCHEMA.md`; the recipe
frontmatter is specified in `library/RECIPE-CONTRACT.md`.

## Options

| Option | Effect |
|---|---|
| `[projectDir]` | the project to analyze (default `.`) |
| `--library <path>` | the library directory to read recipes from. Precedence: `--library`, else `$CODE_QUALITY_LIBRARY`, else the repo-layout default (`library/` two levels up from the skill dir). Passed straight through to the detector. |
| `--json` | print one JSON document instead of the ranked human list |

The detector is spawned as `node <code-quality-setup>/scripts/detect.mjs <projectDir> --library
<libraryDir>`. A detector hard error (a missing project, a missing library) prints the detector's
stderr and exits 1.

## Top level

```jsonc
{
  "schemaVersion": 1,
  "root": "/abs/path/to/project",
  "libraryDir": "/abs/path/to/library",
  "selection": [],   // the detector's selected recipe ids, highest priority first
  "gaps": []         // ranked, 1..n
}
```

`root`, `libraryDir` and `selection` are carried through from the detector report so the caller
never re-derives them. `gaps` is the ranked list; every entry carries a `rank` (1..n over the whole
list) and a `kind`.

## The two gap kinds

### `uncovered-category`

A tooling category the project already uses that no **selected** recipe addresses. One gap per
category, aggregating every package that uses it.

```jsonc
{
  "rank": 1,
  "kind": "uncovered-category",
  "category": "linter",
  "tools": ["eslint"],
  "evidence": [". linter: .eslintrc.json"],
  "packages": ["."]
}
```

| Field | Meaning |
|---|---|
| `category` | the detector's tooling category (`formatter`, `linter`, `typechecker`, `testRunner`, `coverage`, `mutation`, `gitHooks`, `ci`) |
| `tools` | the distinct unaddressed tool names in that category, sorted |
| `evidence` | one `"<pkg> <category>: <files>"` string per unaddressed hit, `<files>` the detector's file list |
| `packages` | the distinct package paths that use the category, sorted |

**The coverage rule.** Coverage is per (category, tool): a detected tool `{ tool, files }` is
addressed when at least one selected recipe satisfies any of:

1. the recipe's `conflicts.tools` names the tool (exact match), **or**
2. the recipe's `files[].path` equals one of that hit's `files` entries, or starts with `<entry>/`
   (the entry is a directory — e.g. the hit `{ tool: "husky", files: [".husky"] }` is addressed by
   a recipe writing `.husky/pre-commit`), **or**
3. the recipe's `files[].path` (the full path, case-insensitive) or any `gates[].run` /
   `commands[].run` contains the tool name.

A category is uncovered when at least one of its detected tools is unaddressed; `tools` lists only
the unaddressed tool names. Coverage is per (category, tool), not per package, so an uncovered
category is uncovered wherever an unaddressed tool appears — every package that uses it lands in
`packages`.

### `one-predicate-away`

A non-selected, non-errored recipe whose **only** failing `when` check is a `requires` predicate, so
a single project change would make it applicable.

```jsonc
{
  "rank": 3,
  "kind": "one-predicate-away",
  "recipe": "ci-drift",
  "title": "CI drift report — one sticky, non-blocking PR comment",
  "purpose": "Post the skill's drift report as one sticky, non-blocking comment on every PR.",
  "failing": { "predicate": "requires {\"file\":\".agents/skills/code-quality-setup/scripts/plan.mjs\"}", "detail": "… is absent at the workspace root" }
}
```

| Field | Meaning |
|---|---|
| `recipe` | the recipe id |
| `title`, `purpose` | carried from the detector's matrix entry |
| `failing.predicate` | the failing reason's `predicate`, always starting with `requires ` |
| `failing.detail` | the failing reason's human-readable `detail` |

A recipe is skipped when it fails **two or more** checks, or when its single failing check is a
`language` / `packageManager` / `workspace` / `excludes` reason — the project cannot satisfy those,
so they are not a gap.

## Ranking

Every `uncovered-category` gap leads every `one-predicate-away` gap. Within `uncovered-category`,
descending number of affected packages, then category name. Within `one-predicate-away`, recipe id.
`rank` is assigned 1..n over the whole list.

## Plain output

Without `--json`, one line per gap:

```
gaps: 3
  1. uncovered-category: gitHooks — husky (.)
  2. uncovered-category: formatter — dprint (.)
  3. one-predicate-away: ci-drift — requires {"file":".agents/skills/code-quality-setup/scripts/plan.mjs"}
```

An empty list prints `no gaps`.

## What it does not do

- No writes, no package manager, no network beyond the detector's own filesystem reads.
- No authoring: it ranks the gaps and stops. The skill presents them and the user picks.
- No local-layer awareness: the detector already merges `.code-quality/` into its matrix, so a local
  recipe that covers a category counts as selected.
