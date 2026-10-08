# `detect.mjs` — output schema and evaluation rules

`node scripts/detect.mjs [projectDir] [--compact]` prints one JSON object to stdout and writes
nothing. Zero dependencies, node builtins only, no package manager invoked. Exit 0 on a report,
exit 1 with a message on stderr when the project or the recipe library is unreadable.

This file is the contract between the detector and everything downstream: the plan renderer, the
applied-state manifest, and the recipes' `when` blocks. `RECIPE-CONTRACT.md` is the other half —
it defines the frontmatter this script reads.

## Top level

```jsonc
{
  "schemaVersion": 1,
  "root": "/abs/path/to/project",
  "stack": { "languages": {}, "packageManager": {}, "workspace": {} },
  "packages": [],     // the root package first, then one entry per workspace member
  "recipes": [],      // one entry per recipe file, in filename order
  "selection": [],    // recipe ids, highest priority first
  "heldBack": [],     // recipes dropped by conflicts.recipes or by a broken `requires`
  "collisions": []    // selected recipes colliding with a pre-existing tool
}
```

## `stack.languages`

| Field | Meaning |
|---|---|
| `typescript` | a `.ts`/`.tsx`/`.mts`/`.cts` file exists, **or** a `tsconfig.json` exists, **or** `typescript` is a dependency |
| `javascript` | a `.js`/`.jsx`/`.mjs`/`.cjs` file exists. A TypeScript project is not a JavaScript project: this is source presence, not "a `package.json` exists" |
| `typescriptStrict` | `true` / `false` / `"mixed"` / `"unknown"` — see below |
| `typescriptStrictSource` | the config file that stated it, `"members"` when aggregated, `null` when unknown |
| `tsconfig` | the root config's path, or `null` |
| `sourceExtensions` | the source extensions actually found, sorted — the evidence behind the two booleans |

`typescriptStrict` is `null` when `typescript` is false.

**Strictness resolution.** `tsconfig.json` is read, and `extends` is followed for relative
specifiers only (a package specifier needs `node_modules`, which the detector never reads; those
land in `unresolvedExtends`). `strict` is `true`/`false` when some file in the chain states it, and
`null` when none does — a solution-style root (`files: []` + `references`) states nothing, and
reporting that as "not strict" would be a lie. When the root states nothing, the project's answer is
aggregated from the packages that do: all `true` → `true`, all `false` → `false`, otherwise
`"mixed"`; nothing stated anywhere → `"unknown"`.

## `stack.packageManager`

`{ name, source, evidence }`. `name` is `bun` / `pnpm` / `npm` / `yarn` / `null`, taken from the
lockfile first (`bun.lock`, `bun.lockb`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`) and
from `package.json#packageManager` only as a fallback. `source` is `"lockfile"` /
`"packageManager-field"` / `null`; `evidence` names the file or field.

## `stack.workspace`

`{ kind, declaration, patterns, members }`. `kind` is `"single"` or `"workspace"`.

- `pnpm-workspace.yaml` wins when it exists — pnpm reads the workspace from there, never from
  `package.json#workspaces`.
- Otherwise `package.json#workspaces`, accepting both the array form and `{ "packages": [...] }`.
- Globs are expanded with a dependency-free matcher: `*` = one path segment, `**` = any depth,
  leading `!` = exclude. A matched directory counts as a member only if it holds a `package.json`.
  Dot-directories are skipped.
- `members` is `[{ path, name }]`, `path` relative to the root, sorted.

## `packages[]`

One entry per package: the root (`role: "root"`, `path: "."`) then each member
(`role: "member"`).

| Field | Meaning |
|---|---|
| `name` | `package.json#name`, or `null` |
| `hasManifest` | a `package.json` exists here |
| `scripts` | the script names, sorted |
| `dependencies` | `dependencies` + `devDependencies` names, sorted |
| `typescript` | `{ configFile, strict, strictSource, solutionStyle, unresolvedExtends }`, or `null` when there is no `tsconfig.json` |
| `tooling` | the categories below, each `[{ tool, files }]` naming the exact files found |

`tooling` categories: `formatter`, `linter`, `typechecker`, `testRunner`, `coverage`, `mutation`,
`gitHooks`, `ci`. A category with nothing found is `[]`.

Two categories are not pure file-presence:

- **`coverage`** has no config file of its own in the common setups. It is reported when a
  dedicated rc file exists (`.nycrc*`, `.c8rc*`) **or** when a test-runner config
  (`vitest.config.*`, `jest.config.*`, `bunfig.toml`) mentions `coverage`.
- **`gitHooks`** also reports live hooks under `.git/hooks/` (anything not `*.sample`), as
  `tool: "git-hooks-path"`.

A directory-shaped candidate (`.husky`, `.github/workflows`) reports its contents, not itself.

## `recipes[]`

One entry per `references/recipes/*.md`, carrying the parsed frontmatter plus the evaluated result:

```jsonc
{
  "id": "biome-assist",
  "error": null,          // a string when the recipe file could not be read; then this is the only
                          // other field present, and the recipe is never selected
  "title": "…", "purpose": "…", "cost": "fast", "priority": 50,
  "applicable": true,     // every `when` check passed
  "selected": true,       // applicable AND survived conflicts
  "reasons": [{ "predicate": "language", "pass": true, "detail": "needs one of [typescript, javascript]; detected typescript" }],
  "files": [], "commands": [], "gates": [], "verify": [],
  "undo": ["…"],          // the body's `## Undo` bullets, extracted for {{plan.details}}
  "conflicts": {}
}
```

`reasons` is the applicability matrix: one entry per check, in evaluation order, each with the
human-readable `detail` that says why it passed or failed. `applicable` is `reasons.every(pass)`.

### The `when` evaluation rules

| Key | Rule |
|---|---|
| `language` | allowlist; passes when **any** member is a detected language |
| `packageManager` | allowlist; passes when the detected manager is a member |
| `workspace` | `any` (default) always passes; `single`/`workspace` compares to `stack.workspace.kind` |
| `requires` | **all** predicates must hold |
| `excludes` | **none** may hold |

Predicates, evaluated against the report:

| Predicate | Holds when |
|---|---|
| `{ file: <path> }` | `<path>` exists at the workspace root |
| `{ dep: <name> }` | `<name>` is in any detected package's `dependencies` or `devDependencies` |
| `{ script: <name> }` | `<name>` is a script in the **root** `package.json` |
| `{ recipe: <id> }` | that recipe is in the current selection |
| `{ recipe: "*" }` | at least one **other** recipe is in the current selection |

A recipe with no `when` keys applies to every stack. The body is never read to decide
applicability.

### Selection is a fixpoint

`requires: [{ recipe: … }]` makes applicability depend on the selection, and `conflicts.recipes`
can remove a recipe another one requires. The detector therefore:

1. **Seeds** with every recipe whose non-recipe checks pass.
2. **Grows** — repeatedly adds any recipe whose `requires` now hold, until nothing changes.
3. **Shrinks** — repeatedly drops the lower-`priority` side of each `conflicts.recipes` pair, then
   drops any recipe whose `requires` no longer hold, until nothing changes.

Dropped recipes land in `heldBack` with the reason. `selection` is sorted by `priority` descending —
the order the plan applies them in.

### `collisions`

For each **selected** recipe, each `conflicts.tools` entry is looked for as a dependency or a config
file **in the project** — never a binary on `PATH`, which is a property of the machine rather than
the repo, and would make the same project collide on one laptop and not in CI. A hit is reported,
never silently dropped:

```jsonc
{ "recipe": "biome-assist", "tool": "prettier",
  "evidence": ["root/package.json declares prettier", "formatter: .prettierrc"] }
```

## What it does not do

- No package manager, no network, no writes.
- No plan rendering, no approval gate, no `.code-quality.json` — those are the manifest and
  invocation-surface tickets.
- No `patch` verification: the contract says the detector cannot verify a `patch`, so it only
  carries the entry through to the plan.
- No `{{plan.gates}}` / `{{plan.details}}` rendering. It supplies the data (`gates`, `undo`) those
  placeholders are built from.

## Hard errors

The detector refuses to guess, but one broken recipe file must not cost the user the whole matrix.
A recipe that cannot be read — a frontmatter line outside the strict subset, an `id` that does not
equal the filename stem, a missing or empty `## Undo` section — is reported as
`{ "id": "<filename stem>", "error": "<what is wrong>" }` in `recipes[]`, is never selected, and
does not stop the other recipes from producing a matrix and a plan. Loud, never a silent skip.

The run itself exits 1 only when there is nothing to report: the target is not a directory, or
`references/recipes/` is missing.
