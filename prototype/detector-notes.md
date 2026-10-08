# Prototype notes — the detector script and its applicability matrix

Throwaway. Branch `prototype/detector`, off `main`, never merged, no PR. This is the primary source
for wayfinder ticket **The detector script and its applicability matrix**; the decision it settled
lives in that ticket's resolution comment.

## What the prototype is

| Artifact | Path |
|---|---|
| The detector | `skills/code-quality-setup/scripts/detect.mjs` |
| The output schema and evaluation rules | `skills/code-quality-setup/scripts/DETECT-SCHEMA.md` |
| Fixtures | `skills/code-quality-setup/fixtures/{plain-ts,bun-ts,pnpm-workspace}/` |
| Throwaway harness (this branch only) | `prototype/transcript.sh` |
| Evidence | `prototype/transcript.txt` |

```
bash prototype/transcript.sh > prototype/transcript.txt
```

Needs `node >= 22`. No dependencies, no package manager, no network.

## What it proved

- **The frontmatter subset is readable with node builtins alone.** The reader is ~90 lines and
  parses both real recipes; a line outside the subset is a hard error, not a silent skip.
- **The three fixtures produce three distinct, correct reports.** `plain-ts` (npm, single, strict,
  no tooling) selects **nothing** — the "nothing applies" path. `bun-ts` (bun, single, biome +
  husky present) selects `biome-assist` + `agent-guidance`. `pnpm-workspace` (pnpm, two members)
  enumerates both members, finds vitest + coverage in `packages/a`, eslint + prettier in
  `packages/b`, and the CI workflow at the root.
- **It survives a real repo.** `omp-factory` (Bun workspace, two members, biome + oxlint + stryker +
  husky + CI + bun coverage) reports in 0.1 s with the right stack, the right per-package tooling,
  and the right selection.
- **The collision path fires.** A scratch copy of `bun-ts` with `prettier` added reports
  `{ recipe: "biome-assist", tool: "prettier", evidence: ["root/package.json declares prettier",
  "formatter: .prettierrc"] }` — loud, not a silent drop.
- **The no-manifest path is safe.** A directory with no `package.json` reports `packageManager:
  null`, an empty selection, and no crash.

## Findings the run forced

Each was wrong in the first draft; the evidence is the run, not an opinion.

1. **A solution-style root tsconfig must not report `strict: false`.** `pnpm-workspace`'s root is
   `{ "files": [], "references": [...] }` — no `compilerOptions` at all. The first draft resolved
   `strict` to `false`, so the stack said "not strict" for a project whose members all extend a
   strict base. `strict` is now `true`/`false`/`null` (null = nothing in the chain states it), and
   the stack-level answer is aggregated from the packages that do state one. The fixture now
   reports `typescriptStrict: true, typescriptStrictSource: "members"`.
2. **`extends` pointing at a *file* was resolved as `<dir>/tsconfig.json`.** `packages/a` extends
   `../../tsconfig.base.json`; the first draft resolved the parent directory and then read the
   root's `tsconfig.json` (the solution file) instead. `packages/a` reported `strict: null` while
   the base said `true`. The resolver now takes a file, handles a directory target, and appends
   `.json` when the extension is left off.
3. **`javascript` must mean "JavaScript source is present", not "a `package.json` exists".** The
   first draft reported `javascript: true` for every fixture, including the TypeScript-only ones,
   which would make a JS-only recipe match a TS repo. It is now source-presence, with
   `sourceExtensions` as the evidence.
4. **Selection is a fixpoint, not a filter.** `requires: [{ recipe: "*" }]` (the agent-guidance
   recipe) makes applicability depend on the selection, and `conflicts.recipes` can remove a recipe
   another one requires. A single pass cannot express either. The detector seeds, grows, then
   shrinks to a stable set, and reports what it dropped in `heldBack`.
5. **`## Undo` extraction is a hard error, not a blank.** The contract already said "fail loudly";
   the detector now refuses to run when a recipe has no `## Undo` section or the section has no
   bullets, rather than rendering an empty "Undo:" into the guidance doc.
6. **`coverage` has no config file of its own.** It is a key inside the test runner's config
   (`vitest.config.ts`, `bunfig.toml`) or a dedicated rc file. The detector reports it from either,
   naming the file — the only category that reads file *content* rather than presence.

## Decisions taken

- **`packageManager` is lockfile-first**, with `package.json#packageManager` only as a fallback and
  `source` naming which one answered. A lockfile is what the project actually installed with.
- **`pnpm-workspace.yaml` wins over `package.json#workspaces`** when both exist, per the monorepo
  research: pnpm reads only the former.
- **`{ dep: … }` matches any detected manifest**, root or member — the contract says "a detected
  manifest's dependencies", and a workspace member's dependency is a real signal.
- **`{ script: … }` matches the root `package.json` only**, per the contract's wording.
- **The detector carries `files`/`commands`/`gates`/`verify`/`undo` through to the plan** rather
  than making the plan renderer re-parse the recipe files. One reader, one parse.
- **`--compact` for machine consumption, pretty JSON by default** — the ticket says the script
  "prints a JSON applicability matrix", and a human reads it first.

## Open questions for the human

1. **Where do the fixtures live?** The ticket says `skills/code-quality-setup/fixtures/`, and they
   are there. But the `skills` CLI copies the whole skill directory into every consumer's
   `.agents/skills/code-quality-setup/`, so the fixtures ship to every install, and the lockfile's
   `computedHash` covers every file — fixture churn invalidates it. `fixtures/` at the repo root
   would keep them out of the install and out of the hash. The ticket's "free of any `SKILL.md`
   file" rule shows the author was already thinking about discovery; this is the other half.
2. **Should `conflicts.tools` look at `PATH`?** The contract says a tool is detected "as a
   dependency, a config file, or a binary on `PATH`". A globally installed `prettier` is not a
   property of the project, so the same repo would collide on one machine and not another, and the
   plan stops being reproducible. The detector implements it as written and labels the evidence
   `binary on PATH at …`, but it is the one signal that is not project-local.
3. **Should a malformed recipe fail the whole run?** The detector exits 1 on bad frontmatter or a
   missing `## Undo`. That is the contract's "hard error", and a malformed recipe is a skill bug
   rather than a project bug — but it means one broken recipe file yields no matrix at all, instead
   of a matrix with one recipe marked broken.

## Gaps this prototype does not close

- **`heldBack` is unexercised.** `biome-assist` declares `conflicts.recipes: [eslint-prettier]`, and
  no such recipe exists yet, so the shrink pass never fires on a committed fixture. It needs two
  recipes that genuinely conflict — the npm/pnpm variants (ticket **Author the fresh recipes,
  including the npm and pnpm variants**) are where that lands.
- **The collision path has no committed fixture.** The only formatter recipe is Bun-gated, so
  `pnpm-workspace`'s prettier + eslint cannot reach it. Proven on a scratch copy instead
  (`transcript.txt` §2); a committed fixture should arrive with the npm variants.
- **`patch` is still unexercised** — unchanged from the recipe-contract prototype.
- **`unresolvedExtends` is reported but never acted on.** A `tsconfig.json` extending
  `@tsconfig/strictest` reports `strict: "unknown"`; whether a recipe should treat that as "needs
  the strict recipe" is a recipe-authoring question, not a detector one.
