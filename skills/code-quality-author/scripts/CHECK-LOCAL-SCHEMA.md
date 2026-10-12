# `check-local.mjs` — output schema and checks

`node scripts/check-local.mjs [projectDir] [--json]` validates a project's local recipe layer at
`<projectDir>/.code-quality/` against the recipe contract and the template formatting rule. It is
the cheap contract check the authoring skill runs before applying a local recipe, mirroring
`scripts/check-library.mjs`. Zero dependencies beyond the shared frontmatter reader. Exit 1 on any
failure, else 0.

The local layer mirrors the library: `.code-quality/recipes/<id>.md` plus
`.code-quality/templates/<id>/…`. The recipe frontmatter is specified in
`library/RECIPE-CONTRACT.md`.

## Options

| Option | Effect |
|---|---|
| `[projectDir]` | the project whose local layer to validate (default `.`) |
| `--json` | print one JSON document instead of the plain summary |

## Top level

```jsonc
{
  "schemaVersion": 1,
  "root": "/abs/path/to/project",
  "localDir": "/abs/path/to/project/.code-quality",
  "recipes": 2,      // recipe files found
  "templates": 0,    // templates biome formatted
  "errors": []       // one string per failure; empty on success
}
```

When `<projectDir>/.code-quality/recipes/` is absent the layer is optional: the plain run prints
`no local recipes` and exits 0, and the `--json` run prints the document above with `recipes: 0`.

## The checks

1. **Recipe contract** — every `.code-quality/recipes/*.md` parses with the shared
   `parseFrontmatter`; `id` equals the filename stem and matches `^[a-z][a-z0-9-]*$`; every
   `files[].template` exists under `.code-quality/`; every `gates[].floor` (when defined) is one of
   `coverage`, `mutation`, `lint`, `typecheck`, `fallow-health`, `fallow-dead-code`.
2. **Template formatting** — every biome-parseable template under `.code-quality/templates/**` is
   `biome format`-clean after the `{{root}}` / `{{plan.*}}` placeholders are substituted with dummy
   values. The parseable extensions are `.json .jsonc .js .mjs .cjs .ts .mts .cts .jsx .tsx`;
   anything else is skipped and printed. A file biome cannot parse is skipped and printed, not
   failed.

The formatter is the project's own: `<projectDir>/node_modules/.bin/biome` when it exists, else
`bunx @biomejs/biome`. The project's `biome.json` is passed as `--config-path` when it exists. When
neither biome nor `bunx` is available the check prints `skip templates — no biome in the project`
and does not fail — the local layer is still valid without a formatter to check it against.

## Plain output

On success:

```
check-local: ok — 2 recipes valid, 0 templates formatted (2 skipped)
```

On failure, one `  - <error>` line per error on stderr:

```
check-local: FAILED (2)
  - .code-quality/recipes/foo.md: gate "g" has floor "bogus" — not one of coverage, mutation, lint, typecheck, fallow-health, fallow-dead-code
  - templates/foo/foo.json: not formatted — run `biome format --write`
```

Skipped templates print as `skip templates/<rel> — <why>` on stdout, before the summary.

## What it does not do

- No writes to the project: templates are copied to a temp dir for the formatter and removed.
- No apply, no plan, no manifest — it validates the local layer and stops.
- No library check: the remote library is validated by `scripts/check-library.mjs`.
