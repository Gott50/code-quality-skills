# Authoring a local recipe or practice

A **local recipe** is a recipe that lives in the project, not in the shared library. A **local
practice** is reference prose for the half of a best practice no gate can fail on. Both follow the
same contract as their library counterparts — `RECIPE-CONTRACT.md` is the source of truth for both
halves — and the detector reads them alongside the library's, with the local one winning on an `id`
collision.

## The local layout

```
.code-quality/
  recipes/<id>.md          the recipe, same frontmatter contract as library/recipes/
  templates/<id>/…         the files its files[].template names
  practices/<id>.md        the practice, same frontmatter contract as library/practices/
```

The local layer mirrors the library: `recipes/` plus `templates/`, and `practices/`. The local
recipes directory is the index the detector scans — there is no local `library.json`. A recipe's or
practice's `id` MUST equal its filename stem, exactly as in the library, and a local
`files[].template` is relative to the local layer (`templates/<id>/…` under `.code-quality/`).

## The three gap kinds

`gaps.mjs` ranks the gaps the shared library leaves in this project, in three kinds:

- **A tooling category the project uses that no selected recipe covers.** The project already runs
  the tool — a formatter, a linter, a test runner — and no recipe in the selection wires it. The
  recipe you write covers that category: it declares the tool in `when` and installs the gate the
  project is missing.
- **A recipe one `when` predicate away.** A library recipe matches everything but one predicate — a
  `packageManager` the project does not use, a `file` it does not have. The recipe you write is that
  recipe's variant for this stack: copy its shape and change the predicate the project fails.
- **A recipe with a gate and no practice.** A selected recipe installs a gate, but no selected
  practice names it in `enforcedBy` — the project gets the check without the prose that explains the
  judgement the check cannot make. The practice you write names that recipe in `enforcedBy` and
  carries the rule the gate cannot fail on. The gap's `namedBy` tells you which: empty means the
  library has no practice for the recipe at all, non-empty means it has one whose `when` excludes
  this stack, so you write a variant.

The first two are read off the detector's per-package `tooling` categories and per-recipe
`reasons[]`; the third off the per-recipe `gates[]` and the per-practice `enforcedBy`. The ranking
needs no new analysis.

## The fields that matter when authoring a recipe

- **`when`** — the machine-checkable applicability. A local recipe is selected only when its `when`
  holds, so the predicate the gap named is the one to write. Prose judgement belongs here as a
  predicate or not at all.
- **`conflicts`** — what must not be applied alongside. A variant of a library recipe conflicts with
  it (`conflicts.recipes`), so the two are never selected together.
- **`files`** — the templates to write, each naming its `action` and `scope`.
- **`gates`** — the project-facing checks the recipe leaves behind. A gate that ratchets declares
  `floor`.
- **`verify`** — how the recipe proves itself. The proof is the gate, stated once.

## The fields that matter when authoring a practice

- **`when`** — the practice's own applicability, the same predicate language. A practice is selected
  by its own `when` and can be selected with no recipe at all, so a practice for a stack the library
  practice excludes is a local practice with a `when` that matches it.
- **`source`** — a project-relative path to the note the practice is drawn from. The check refuses a
  path that does not exist under the project root.
- **`enforcedBy`** — the recipe ids whose machine-checkable half the practice explains. The check
  refuses an id that names no recipe in the merged layer (the local recipes plus the library's).
  Empty is valid: a practice can be pure prose.

## The body

A recipe's body has three headings, in this order: `## Apply` (the ordered steps, each naming the
frontmatter entry it acts on), `## Idempotency` (what a re-run does when its output is already
present, and when it has drifted), `## Undo` (the exact revert, per `files` entry). The detector
hard-errors on a missing or empty `## Undo`.

A practice's body is reference prose, not steps: it opens with the rule as one imperative sentence,
has no required headings, and must not restate a gate (the recipe owns that) or the research note
(it links it). Delivery is one file per practice at `docs/code-quality/practices/<id>.md`, listed
inline in the `agent-guidance` block.

## The validation loop

A written-but-unapplied recipe is unproven. The project **is** the fixture:

1. `node scripts/check-local.mjs [projectDir] --library <libraryDir>` — the contract and formatting
   check. It must pass before installing.
2. `node <code-quality-setup>/scripts/plan.mjs [projectDir] --library <libraryDir>` — the plan
   selects the local recipe and shows what it writes.
3. Apply the plan on approval, and require the plan's gates to pass. A gate that fails is a missing
   apply step, not a `verify` exception.
4. Record the recipe through the setup skill's canonical writer (`manifest.mjs record`).

A practice has no gate of its own, so its proof is the delivery: the plan writes
`docs/code-quality/practices/<id>.md` and `agent-guidance` points at it. `check-local.mjs` is the
whole check — the practice contract, and the recipe ids its `enforcedBy` resolves against.

`RECIPE-CONTRACT.md` (in the fetched `libraryDir`) is the source of truth for every rule above; this
guide names only what changes when the artifact is local.
