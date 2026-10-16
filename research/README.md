# Research notes

`/research/` is the repo-root landing zone for research notes. Each note records
what one best-practice question resolved to: the question, the verdict, the
primary sources, and the findings that back the verdict. The eight existing
notes are the worked examples — `testing.md`, `coverage.md`, `mutation.md`,
`lint-typecheck.md`, `dead-code-complexity.md`, `ci-hooks.md`, `formatting.md`,
`agent-conventions.md`.

## Naming

One topic per file: `research/<topic>.md`, kebab-case topic. The filename stem is
the `topic` slug.

## Frontmatter

Every note opens with YAML frontmatter carrying exactly four keys:

```yaml
---
topic: testing          # the slug, matching the filename stem
question: >-            # the question the note answers (folded scalar)
  What distinguishes a test that earns its place from one that is ceremony?
verdict: >-             # the answer in one paragraph (folded scalar)
  Only assertion strength and the never-fails test have a gate that fails on
  the practice itself; the rest is judgement.
sources:                # a YAML list of primary-source URLs
  - https://martinfowler.com/bliki/AssertionFreeTesting.html
  - https://stryker-mutator.io/docs/
---
```

`question` and `verdict` are folded scalars (`>-`); `sources` is a list of
primary-source URLs.

## Body

Below the frontmatter: the findings, with every claim cited to its primary
source. Cite the source inline next to the claim; the frontmatter `sources`
list is the index of what the note drew on, not the citation itself.

## Routing

Every note closes with a `## Routing` section: a table naming, per practice,
whether a gate can fail on it — a recipe id from `library/recipes/` — or not —
a `library/practices/<id>.md` agent instruction. The judgement half of a
practice has no gate, so it reaches the agent as prose; the machine-checkable
half is a recipe.

## Why repo-root, never inside a skill directory

The skills CLI copies the whole `skills/<name>/` directory into every consumer's
`.agents/skills/<name>/`, so anything inside a skill directory ships to every
user and churns the lockfile's `computedHash`, which covers every file in the
skill dir. Research notes are repo-internal, so they live at the repo root.

## Landing

Research results land on `main`. This overrides wayfinder's default of a
throwaway `research/<name>` branch that is never merged.
