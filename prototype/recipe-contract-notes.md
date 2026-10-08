# Prototype notes — the recipe contract

Throwaway. Branch `prototype/recipe-contract`, off `main`, never merged, no PR. This is the primary
source for wayfinder ticket **The recipe contract, proven by two real recipes**; the decision it
settled lives in that ticket's resolution comment.

## What the prototype is

| Artifact | Path |
|---|---|
| The contract | `skills/code-quality-setup/RECIPE-CONTRACT.md` |
| Recipe A — ported, Bun-gated | `skills/code-quality-setup/references/recipes/biome-assist.md` |
| Recipe B — fresh, package-manager-agnostic | `skills/code-quality-setup/references/recipes/agent-guidance.md` |
| Templates | `skills/code-quality-setup/templates/{biome-assist,agent-guidance}/` |
| Throwaway harness (this branch only) | `prototype/apply.mjs`, `prototype/fixture.sh` |
| Evidence | `prototype/transcript.txt` |

The harness is **not** the deliverable: it is a ~180-line stand-in for the audit→plan→apply engine
(the detector and the manifest are their own tickets), written only to apply both recipes to a
scratch project repeatably. It has absolute paths to this machine; re-running needs
`bun 1.4.x`, `node >= 22`, and network for `bun install`.

```
rm -rf /tmp/cqs-fixture && bash prototype/fixture.sh
```

## What it proved

Both recipes apply to a bare Bun TypeScript package, both verify green, a second run is a **full
no-op** (every `create`/`merge` reports "no-op (identical)"), and the pre-commit hook runs for real:
a staged unsorted file is formatted, **re-staged**, and the committed blob is the formatted one
(`prototype/transcript.txt`, §4). The frontmatter is machine-readable by a dependency-free reader.

## Contract changes the manual application forced

Each of these was wrong in the first draft; the evidence is the run, not an opinion.

1. **A template must already satisfy the gates its recipe turns on.** The first `biome.json`
   template was hand-ordered, and the assist actions it enables (`useSortedKeys`) immediately
   flagged it — `biome check .` failed on the recipe's own output, and the sweep then rewrote the
   file so it no longer equalled the template. Permanent drift from the first run. The template is
   now pre-sorted, and the rule is stated.
2. **Turning a formatter on needs an explicit one-time sweep.** `verify` cannot be green on any repo
   that is not already formatted: the first run failed on `tsconfig.json`, `package.json` and
   `biome.json` — two of which the recipe never wrote. `commands[]` now carries
   `bunx @biomejs/biome check --write --unsafe --linter-enabled=false .` with `showInPlan: true`,
   because it rewrites files the recipe did not author. My first guess, a `verify.expect:
   exit0-after-fix` escape hatch, is dead — the missing apply step was the bug.
3. **`commands[]` is "what the skill runs", not "commands the recipe mentions".** The ported hook
   line (`biome check --staged …`) is template content — git runs it, never the skill. Listing it as
   a command would make the skill run it at apply time. Stated as a rule.
4. **The re-stage line must be `git add -u`; bare `git add` is a silent no-op.** Verified on git
   2.54.0: `git add` with no pathspec prints *"Nothing specified, nothing added."*, exits **0**, and
   stages nothing — so `|| exit 1` never fires and the formatted content never reaches the commit.
   The `biome-enable-all-assist` source recipe carries the broken line; with `-u` the committed blob
   is the formatted one. This is the highest-value port finding: the hook looked wired and committed
   unformatted code.
5. **The marker comment syntax must be valid in the target language.** `<!-- code-quality:…:start -->`
   at the top of `.husky/pre-commit` is a shell redirection: `line 1: syntax error near unexpected
   token 'newline'`, and every commit fails. The marker lines are now whatever the template says —
   `#` in shell, `<!-- -->` in Markdown — located by substring. No new frontmatter field; the
   template stays the single source of truth.
6. **`verify[]` and the project's gates are different objects.** Rendering the guidance table from
   `verify[]` produced a self-referential row whose "command" was the guidance recipe's own
   bookkeeping check. Split: a new `gates[]` block (project-facing: `id`/`run`/`description`) and
   `verify[]` entries that reference a gate by id — which also removes the duplication of stating a
   gate's command twice.
7. **`{{plan.gates}}` must render the whole table, not bare rows.** Header-in-template plus
   rows-from-placeholder has no good answer for an empty selection; the placeholder now renders a
   complete table, or `_No gates wired._`.
8. **The single-package collapse needs an explicit rule.** Recipe A declares two `biome.json`
   entries (`root`, `member`); in a single-package repo they resolve to the same path, and without
   the rule the member stub (`extends: ["//"]`) would be written over the root config. Rule: a
   `member` entry is skipped when a `root` entry writes the same path.
9. **A JSON merge needs a collision rule.** `prepare: husky` may already exist holding another
   command; overwriting it silently is wrong. Rule: adding a missing key is fine, changing an
   existing value is a collision the plan must show.
10. **A recipe's output can depend on the whole selection, so templates need substitution.**
    `docs/code-quality.md` describes whichever recipes were selected, which is not knowable when the
    recipe is authored. Two placeholders (`{{plan.gates}}`, `{{plan.details}}`) keep it a static
    template; the consequence — the doc differs by design when the selection changes, so the plan
    shows it catching up — is stated.
11. **The frontmatter subset is readable with ~70 lines of Node builtins**, but flow-style values
    need bare-token quoting before `JSON.parse` and block sequences need a small state machine. The
    reader rules are now in the contract. Open decision below.
12. **Extracting the body's `## Undo` for `{{plan.details}}` is fragile.** My first regex used `$`
    with the `m` flag and silently captured one line, rendering an empty "Undo:". The detector
    ticket should fail loudly on a missing or empty required section rather than render blank.

## Observations that are not contract changes

- **Recipe A is Bun-gated** (`when.packageManager: [bun]`); npm and pnpm variants are the port
  ticket's, per the non-Bun-equivalents research.
- **`needs` (recipe→recipe dependency) was considered and not forced.** Recipe A is self-contained
  and Recipe B orders last by `priority`; a `needs` field earns its place only when a recipe needs
  another's *output*, which these two do not. Left out rather than speculated in.

## Decisions taken with the human

1. **Frontmatter token style: bare tokens.** `[typescript]`, `{ file: package.json }` stay; the
   reader quotes bare tokens before `JSON.parse`. Readability wins over a plain `JSON.parse`.
2. **Shared files: whoever needs a line merges into it, and every block names its recipe.** No
   `git-hooks` recipe owning `.husky/pre-commit`; each hook-using recipe merges its own
   marker-scoped block. The contract now states the attribution rule explicitly: a merged block's
   marker names the `<id>`, so a reader can see which recipe owns which lines and update or remove
   exactly that block.
3. **`.gitignore`: each recipe adds its own lines, marker-scoped.** No separate `gitignore` recipe.
   Recipe A now merges `node_modules/` under `code-quality:biome-assist`; the coverage and mutation
   recipes will add `coverage/`, `reports/`, `.stryker-tmp/` under their own markers. Verified: the
   fixture no longer stages `node_modules/`.
