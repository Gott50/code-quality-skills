# Authoring a local recipe

A **local recipe** is a recipe that lives in the project, not in the shared library. It follows the
same contract as a library recipe — `RECIPE-CONTRACT.md` is the source of truth for both halves —
and the detector reads it alongside the library's, with the local one winning on an `id` collision.

## The local layout

```
.code-quality/
  recipes/<id>.md          the recipe, same frontmatter contract as library/recipes/
  templates/<id>/…         the files its files[].template names
```

The local layer mirrors the library: `recipes/` plus `templates/`. The local recipes directory is
the index the detector scans — there is no local `library.json`. A recipe's `id` MUST equal its
filename stem, exactly as in the library, and a local `files[].template` is relative to the local
layer (`templates/<id>/…` under `.code-quality/`).

## The two gap kinds

`gaps.mjs` ranks the gaps the shared library leaves in this project, in two kinds:

- **A tooling category the project uses that no selected recipe covers.** The project already runs
  the tool — a formatter, a linter, a test runner — and no recipe in the selection wires it. The
  recipe you write covers that category: it declares the tool in `when` and installs the gate the
  project is missing.
- **A recipe one `when` predicate away.** A library recipe matches everything but one predicate — a
  `packageManager` the project does not use, a `file` it does not have. The recipe you write is that
  recipe's variant for this stack: copy its shape and change the predicate the project fails.

The first kind is a new gate; the second is a variant of an existing one. Both are read off the
detector's existing output — the per-package `tooling` categories and the per-recipe `reasons[]` —
so the ranking needs no new analysis.

## The fields that matter when authoring

- **`when`** — the machine-checkable applicability. A local recipe is selected only when its `when`
  holds, so the predicate the gap named is the one to write. Prose judgement belongs here as a
  predicate or not at all.
- **`conflicts`** — what must not be applied alongside. A variant of a library recipe conflicts with
  it (`conflicts.recipes`), so the two are never selected together.
- **`files`** — the templates to write, each naming its `action` and `scope`.
- **`gates`** — the project-facing checks the recipe leaves behind. A gate that ratchets declares
  `floor`.
- **`verify`** — how the recipe proves itself. The proof is the gate, stated once.

## The body

Three headings, in this order: `## Apply` (the ordered steps, each naming the frontmatter entry it
acts on), `## Idempotency` (what a re-run does when its output is already present, and when it has
drifted), `## Undo` (the exact revert, per `files` entry). The detector hard-errors on a missing or
empty `## Undo`.

## The validation loop

A written-but-unapplied recipe is unproven. The project **is** the fixture:

1. `node scripts/check-local.mjs [projectDir]` — the contract and formatting check. It must pass
   before installing.
2. `node <code-quality-setup>/scripts/plan.mjs [projectDir] --library <libraryDir>` — the plan
   selects the local recipe and shows what it writes.
3. Apply the plan on approval, and require the plan's gates to pass. A gate that fails is a missing
   apply step, not a `verify` exception.
4. Record the recipe through the setup skill's canonical writer (`manifest.mjs record`).

`RECIPE-CONTRACT.md` (in the fetched `libraryDir`) is the source of truth for every rule above; this
guide names only what changes when the recipe is local.
