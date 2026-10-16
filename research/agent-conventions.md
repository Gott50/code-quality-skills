---
topic: agent-conventions
question: >-
  What makes a repo legible to the next agent session? What belongs in AGENTS.md versus a
  linked doc, how should marker-delimited ownership of shared files work, what does a stale
  instruction cost, and how should a gate table read — and which of these can a gate enforce
  versus which stay judgement?
verdict: >-
  The three agent harnesses that matter (Codex, Claude Code, the AGENTS.md format) agree on the
  shape: AGENTS.md is always-loaded, size-capped, and concatenated nearest-wins, so it must hold
  only what changes behaviour every session, with everything else behind a one-line pointer.
  Marker-delimited ownership is the only mechanism that lets several writers share one file
  without a merge conflict in a human's head; the library already implements it and the only gap
  is that the rule is enforced at review time, not by the detector. A stale instruction is not
  inert: it competes for attention with the live ones, and both harnesses ship tooling
  (`/doctor prompt-audit`, Codex's re-read-every-run) because the failure is silent. A gate table
  must be rendered from the selection, not written, and must not flatten the floor/wall
  distinction. Most of this is mechanically checkable; the residue — whether a sentence earns its
  context load, and whether a marker comment is valid in its target language — is judgement.
sources:
  - https://agents.md/
  - https://learn.chatgpt.com/docs/agent-configuration/agents-md
  - https://learn.chatgpt.com/docs/config-file/config-advanced
  - https://code.claude.com/docs/en/memory
  - https://code.claude.com/docs/en/skills
  - https://code.claude.com/docs/en/features-overview
  - https://code.claude.com/docs/en/context-window
  - https://code.claude.com/docs/en/prompt-caching
  - https://code.claude.com/docs/en/best-practices
  - https://code.claude.com/docs/en/large-codebases
  - https://code.claude.com/docs/en/claude-directory
  - https://code.claude.com/docs/en/debug-your-config
  - https://code.claude.com/docs/en/plugins/manifest-reference
  - https://code.claude.com/docs/en/plugins/security
  - https://code.claude.com/docs/en/plugins/measure
  - https://code.claude.com/docs/en/plugins/org
  - https://code.claude.com/docs/en/plugins/troubleshooting
  - https://code.claude.com/docs/en/plugin-evals
  - https://code.claude.com/docs/en/plugins/mods/overview
  - https://code.claude.com/docs/en/plugins/mods/admin
  - https://code.claude.com/docs/en/plugins/mods/reference
  - https://code.claude.com/docs/en/plugins/mods/events
  - https://code.claude.com/docs/en/plugins/mods/interface
  - https://code.claude.com/docs/en/plugins/mods/create
  - https://code.claude.com/docs/en/plugins/mods/troubleshoot
  - https://code.claude.com/docs/en/plugins/mods/test
  - https://code.claude.com/docs/en/plugins/loading
  - https://code.claude.com/docs/en/plugins/components
  - https://code.claude.com/docs/en/plugins/cli-reference
  - https://code.claude.com/docs/en/plugins/host-marketplace
  - https://code.claude.com/docs/en/plugins/marketplace-reference
  - https://code.claude.com/docs/en/plugins/relevance
  - https://code.claude.com/docs/en/plugins/publish
  - https://code.claude.com/docs/en/plugins/dependencies
  - https://code.claude.com/docs/en/plugins/create
  - https://code.claude.com/docs/en/plugins/create-marketplace
  - https://code.claude.com/docs/en/plugins/cli-hints
  - https://code.claude.com/docs/en/plugins/anthropic-marketplaces
  - https://code.claude.com/docs/en/settings
  - https://code.claude.com/docs/en/settings-example
  - https://code.claude.com/docs/en/permissions
  - https://code.claude.com/docs/en/permission-modes
  - https://code.claude.com/docs/en/sandboxing
  - https://code.claude.com/docs/en/security
  - https://code.claude.com/docs/en/hooks
  - https://code.claude.com/docs/en/sub-agents
  - https://code.claude.com/docs/en/glossary
  - https://code.claude.com/docs/en/costs
  - https://code.claude.com/docs/en/output-styles
---

# What makes a repo legible to the next agent session

Local evidence: `library/RECIPE-CONTRACT.md`, `library/recipes/*.md`, `library/templates/agent-guidance/`,
`GLOSSARY.md`, `skills/code-quality-setup/scripts/plan.mjs`, `scripts/check-library.mjs`, and the
vendored `skill://writing-for-agents`.

## 1. What belongs in `AGENTS.md`, what belongs behind a pointer

**The format itself imposes almost nothing.** AGENTS.md is "just standard Markdown" with no required
fields — the agent parses the text you provide — and it exists as a sibling to `README.md` because a
README is for humans: build steps, tests and conventions "might clutter a README or aren't relevant to
human contributors" ([agents.md](https://agents.md/)). Codex reads `AGENTS.md` before doing any work
([Codex, Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)).

**Discovery is nearest-wins, which is the whole design.** Codex builds an instruction chain once per
run: global scope (`AGENTS.override.md`, else `AGENTS.md`, first non-empty file only), then from the
project root down to the working directory, at most one file per directory, concatenated root-down and
joined with blank lines — so files closer to the working directory override earlier guidance because
they appear later in the combined prompt. Empty files are skipped, and concatenation **stops once the
combined size reaches `project_doc_max_bytes` (32 KiB by default)**. The documented remedy for hitting
the cap is to "raise the limit or split instructions across nested directories"
([Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md)). The project root itself is a
configured notion: Codex walks up to a directory containing `.git` by default, overridable with
`project_root_markers` ([Codex, Advanced Configuration](https://learn.chatgpt.com/docs/config-file/config-advanced)).

The same layering appears in the format's own guidance: "Large monorepo? Use nested AGENTS.md files for
subprojects… Agents automatically read the nearest file in the directory tree, so the closest one takes
precedence" ([agents.md](https://agents.md/)).

Claude Code's equivalent is documented with the budgets made explicit:

- `CLAUDE.md` (or a repository's `AGENTS.md`, read in its place) is loaded at the start of every session
  as a **user message after the system prompt**, and is treated as context, not enforced configuration:
  "The more specific and concise your instructions, the more consistently Claude follows them"
  ([Claude Code, memory](https://code.claude.com/docs/en/memory)).
- **Target under 200 lines per file.** "Longer files consume more context and reduce adherence." And
  critically: `@path` imports "help you organize a long file but don't reduce its context cost, because
  imported files also load at launch" ([memory](https://code.claude.com/docs/en/memory)).
- The disclosed material has two homes, chosen by *branch*: "If an entry is a multi-step procedure or
  only matters for one part of the codebase, move it to a skill or a path-scoped rule instead"
  ([memory](https://code.claude.com/docs/en/memory)). Path-scoped rules "only apply when Claude is
  working with files matching the specified patterns" ([memory](https://code.claude.com/docs/en/memory));
  a skill's body "loads only when it's used, so long reference material costs almost nothing until you
  need it" ([skills](https://code.claude.com/docs/en/skills)).
- The cost table that makes the choice mechanical: `CLAUDE.md` loads full content at session start and
  costs "every request"; a skill loads descriptions at start and full content only when used, cost "low"
  ([features-overview](https://code.claude.com/docs/en/features-overview)).

**The concrete include/exclude line.** Claude Code's own list: include commands Claude can't guess, code
style rules that differ from defaults, testing instructions, repository etiquette, architectural
decisions, developer-environment quirks, common gotchas. Exclude anything Claude can figure out by
reading code, standard language conventions, detailed API documentation ("link to docs instead"),
information that changes frequently, long explanations, file-by-file descriptions, self-evident
practices ([best-practices](https://code.claude.com/docs/en/best-practices)).

**And the pattern this repo already follows.** The root `AGENTS.md` here is short: what the product is,
then one line per topic pointing at `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`,
`docs/agents/domain.md`. The library's own recipe is named for the same shape — "a lean AGENTS.md
section pointing at `docs/code-quality.md`" — and its Apply step states the rule: the merged section
"carries only the gate table (`{{plan.gates}}`) and the pointer to `docs/code-quality.md`; everything
else is disclosed behind that pointer" ([library/recipes/agent-guidance.md](library/recipes/agent-guidance.md)).

**One counter-case worth encoding.** A `CLAUDE.md` at a *plugin* root is not project context at all:
"Claude Code doesn't load a `CLAUDE.md` at the plugin root, and `claude plugin validate` warns
`CLAUDE.md at the plugin root is not loaded as project context`. To include instructions in a plugin,
write them as a skill" ([plugins/manifest-reference](https://code.claude.com/docs/en/plugins/manifest-reference),
[plugins/components](https://code.claude.com/docs/en/plugins/components)). A doc placed where the
harness does not look is worse than a missing one, because it reads as done.

## 2. Marker-delimited ownership of shared files

The glossary fixes the term: a **Merge block** is "the marker-delimited region of a shared file that
exactly one recipe owns" ([GLOSSARY.md](GLOSSARY.md)).

The contract that implements it ([library/RECIPE-CONTRACT.md](library/RECIPE-CONTRACT.md), `files`):

- `action: merge` "insert or replace a marker-delimited block inside an existing file, leaving
  everything outside the markers untouched."
- "The marker lines are the template's own lines containing `code-quality:<id>:start` and
  `code-quality:<id>:end`, taken verbatim; **`<id>`-scoping lets several recipes merge into one file
  without clobbering each other**."
- "**The comment syntax is the template's choice and MUST be a valid comment in the target language**:
  `<!-- … -->` for Markdown and HTML, `#` for shell, YAML and TOML, `//` for JS and TS. A
  `.husky/pre-commit` body is executed by `sh`, where `<!--` is a redirection — the wrong choice is a
  syntax error at every commit, not a cosmetic one."
- "**Every merged block is attributable to its recipe.** … A recipe MUST NOT write into a shared file
  without markers, and MUST NOT write a block whose marker omits its id."

Two failure modes are given their own verdicts rather than being folded into drift:

- **Duplicate** — "A marker block the file already carries without a marker is a duplicate: the plan
  reports it … and the apply MUST NOT append it — the gate is already wired, and appending would run it
  twice" (the hand-set-up repo, #35). The plan renders that recipe's `verify` with the marker grep
  replaced by `true` so the recipe is recorded rather than re-run forever (#49).
- **Collision** — "A merge that would change an existing value is a collision: it is reported in the
  plan and applied only on approval."

The library's own `AGENTS.md` section is the worked example: an HTML-comment pair
`<!-- code-quality:agent-guidance:start -->` / `:end`, because the target is Markdown
([library/templates/agent-guidance/AGENTS.md](library/templates/agent-guidance/AGENTS.md)). Three
recipes share `.gitignore` under three separate marker pairs, and the hygiene block deliberately carries
"only the entries no other recipe owns", with `node_modules/`, `coverage/` and `.stryker-tmp/` left to
the recipes that produce them ([library/recipes/repo-hygiene.md](library/recipes/repo-hygiene.md)).

The rule is also stated where the human reads it, not only where the recipe author does:
`docs/code-quality.md` ends with "Marker-delimited blocks (`code-quality:<recipe>`) are owned by their
recipe: edit them only by editing the recipe, or the next run reports drift"
([library/templates/agent-guidance/docs/code-quality.md](library/templates/agent-guidance/docs/code-quality.md)).

**Same idea, different medium.** The drift workflow posts *one sticky PR comment* by passing a
`header:` marker to `marocchino/sticky-pull-request-comment@v3`: "the action embeds the `header` as a
marker in the body and finds and updates that comment in place, so the workflow carries no
comment-management code of its own. `actions/github-script` would mean hand-rolling the list/find/patch-
or-create logic — pagination, the marker, the update path — for no gain"
([library/recipes/ci-drift.md](library/recipes/ci-drift.md)).

## 3. What a stale instruction costs

The cost is not "a wasted line". It is that a stale instruction **competes with the live ones for the
same attention budget**:

- "If two instructions contradict each other, Claude may pick one arbitrarily. Review your CLAUDE.md
  files, nested CLAUDE.md files in subdirectories, and `.claude/rules/` periodically to remove outdated
  or conflicting instructions" ([memory](https://code.claude.com/docs/en/memory)).
- The failure is named as a pattern: "**The over-specified CLAUDE.md.** If your CLAUDE.md is too long,
  Claude ignores half of it because important rules get lost in the noise. **Fix**: Ruthlessly prune. If
  Claude already does something correctly without the instruction, delete it or convert it to a hook"
  ([best-practices](https://code.claude.com/docs/en/best-practices)).
- The diagnostic is behavioural, not textual: "If Claude keeps doing something you don't want despite
  having a rule against it, the file is probably too long and the rule is getting lost"
  ([best-practices](https://code.claude.com/docs/en/best-practices)). "Bloated CLAUDE.md files cause
  Claude to ignore your actual instructions" ([best-practices](https://code.claude.com/docs/en/best-practices)).
- Age is a cause in itself: "Revisit after major model releases: instructions that worked around an
  older model's limitation may become overhead once a newer model handles the case on its own"
  ([large-codebases](https://code.claude.com/docs/en/large-codebases)).

Both harnesses ship tooling because the failure is silent. Claude Code has `/doctor prompt-audit`, which
"looks for problems such as instructions written for older models, references to files or commands that
don't exist, and files that contradict each other"
([memory](https://code.claude.com/docs/en/memory)); `/doctor` separately proposes trims for a checked-in
`CLAUDE.md`, "cut[ting] content Claude can derive from the codebase, such as directory layouts,
dependency lists, and architecture overviews, and keep[ing] pitfalls, rationale, and conventions that
differ from tool defaults" ([memory](https://code.claude.com/docs/en/memory)). Codex's answer is to
re-read: "If instructions look stale, restart Codex in the target directory. Codex rebuilds the
instruction chain on every run… so there is no cache to clear manually"
([Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md)).

Two mechanical ceilings exist and are worth knowing because they fail *loudly* rather than silently:
Claude Code "loads a CLAUDE.md file of up to 4 MiB in full and skips a larger file"
([memory](https://code.claude.com/docs/en/memory)), and Codex truncates the concatenation at
`project_doc_max_bytes` ([Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md)).

**A stale instruction can also change which instructions load at all.** In Claude Code, a
`CLAUDE.local.md` "counts" for the AGENTS.md check — adding one to a repo that relies on `AGENTS.md`
"stops Claude from reading `AGENTS.md` for you"
([memory](https://code.claude.com/docs/en/memory)). A leftover personal file silently swaps the whole
instruction set.

**Mid-session edits do not apply.** A project-root `CLAUDE.md` is "read once at session start and held
in memory. Editing them mid-session does not invalidate the cache, but the edit also doesn't apply" —
it takes effect on the next `/clear`, `/compact`, or restart
([prompt-caching](https://code.claude.com/docs/en/prompt-caching)). A doc that is stale at session start
stays stale for the whole session.

**What this repo can already detect.** Drift, not staleness-of-prose. `plan.mjs --check` "exits 1
whenever the report is not clean (drift, or a degraded report with no manifest)"
([library/recipes/ci-drift.md](library/recipes/ci-drift.md)). The agent-guidance recipe's own
idempotency section is explicit that a *correct* staleness is still drift: "Both targets re-render from
the current selection, so a later run that selects a new recipe produces a changed
`docs/code-quality.md` and a changed `{{plan.gates}}` table. That difference is drift by design." And it
draws the line the check needs: "A repo-wide formatter sweep … that re-aligns the block's table is not
drift: the plan reads a formatter-only rewrite of the marker block as `intact` … A hand-edit that
changes the block's content still reads `drifted`"
([library/recipes/agent-guidance.md](library/recipes/agent-guidance.md)).

**The judgement residue** is the no-op test from the vendored skill: "an instruction the model already
obeys by default pays load to say nothing. The test (does it change behaviour versus the default?) is
model-relative, not reader-relative: two people disagreeing about a no-op disagree about the default,
and settle it by running the document, not by debate." Its companion is the cache rule: "The environment
is a source of truth too (`package.json` scripts, config files, the directory layout, `--help` output),
and a document that restates it is a **cache**: a copy of a lookup, earning its load only when the
lookup is expensive." And the default fate without pruning: "**sediment**: stale layers that settle
because adding feels safe and removing feels risky, until you must core down through them to find what
is still live" ([skill://writing-for-agents](skill://writing-for-agents), Pruning).

## 4. How a gate table should read

**Rendered, never written.** `{{plan.gates}}` renders "one complete Markdown table of every selected
recipe's gates, or `_No gates wired._` when the selection has none"
([RECIPE-CONTRACT.md](library/RECIPE-CONTRACT.md), Substitution). The renderer's columns are fixed —
`| Gate | Command | What it checks |` — and rows are built by flattening `r.gates` over **every selected
recipe**, not from the recipe that writes the table, which "is what lets a recipe whose output describes
the whole run stay a static template"
([skills/code-quality-setup/scripts/plan.mjs](skills/code-quality-setup/scripts/plan.mjs) `renderGatesTable`;
[agent-guidance](library/recipes/agent-guidance.md)). The fallback string is asserted in the library
check (`["{{plan.gates}}", "_No gates wired._"]`,
[scripts/check-library.mjs](scripts/check-library.mjs)).

**What each row may claim.** `gates[].id` is unique within the recipe; `run` is the project-facing
command; `description` is "what it checks"; and an optional `floor` names the gate whose recorded level
is this gate's floor ([RECIPE-CONTRACT.md](library/RECIPE-CONTRACT.md), `gates`).

**The floor/wall distinction is the thing a hand-written table loses.** "A gate WITHOUT `floor` is a wall
at a fixed level — a formatter's zero-diff gate has no floor… With **no baseline** … the floor falls
back to the greenfield wall: 100% for coverage and mutation, 0 for lint and typecheck, and fallow's
report-only mode" ([RECIPE-CONTRACT.md](library/RECIPE-CONTRACT.md), `floor`). A gate with a floor "MUST
read its floor from that source at run time — never from a hard-coded level — and the recipe's body MUST
say where the floor is read" ([RECIPE-CONTRACT.md](library/RECIPE-CONTRACT.md)). So a table that shows
only `run` tells a reader the command but not what the command is *anchored to*; that detail belongs in
`docs/code-quality.md` via `{{plan.details}}` (title, purpose, gates, undo bullets), which the AGENTS.md
block points at ([agent-guidance](library/recipes/agent-guidance.md)).

**The header sentence is imperative and scoped.** The rendered block opens: "Gates wired by
`code-quality-setup`. Run them before you commit; the pre-commit hook runs the fast ones for you."
([library/templates/agent-guidance/AGENTS.md](library/templates/agent-guidance/AGENTS.md)). It tells the
reader which of the listed commands they are expected to run and which one runs itself.

**A table must not name a command that isn't there.** Two grounded precedents:

- `ci-workflow` "requires the fast-gate recipes it wires … because the workflow calls their scripts by
  name. The detector reports a missing one as the failing reason rather than writing a workflow whose
  steps would fail on a missing script"
  ([library/recipes/ci-workflow.md](library/recipes/ci-workflow.md)).
- Where a script's existence is genuinely conditional, the condition is on the **step**, not the job:
  "The gate step itself carries `if: hashFiles('scripts/mutation-gate.ts') != ''` … The `if` is
  step-level because a job-level `hashFiles` is evaluated before the checkout and sees no files"
  ([ci-workflow](library/recipes/ci-workflow.md)).

**Blocking vs non-blocking must be legible from the table.** `ci-drift`'s check "exits 1 whenever the
report is not clean", and the workflow deliberately ignores it and marks the comment step
`continue-on-error`: "The job never fails a PR… a drift report is a signal, never a gate"
([library/recipes/ci-drift.md](library/recipes/ci-drift.md)). A table that lists a signal beside a gate
without saying which is which misleads the reader about what will stop them.

## 5. Enforceable vs judgement

**Enforceable today, by an existing recipe:**

- `AGENTS.md` carries the marker block and the pointer target exists — `agent-guidance`'s `verify` is
  `test -f docs/code-quality.md && grep -q "code-quality:agent-guidance:start" AGENTS.md`
  ([library/recipes/agent-guidance.md](library/recipes/agent-guidance.md)).
- The table and the details are regenerated from the selection — `agent-guidance` uses `action: merge`
  for `AGENTS.md` and `action: create` for `docs/code-quality.md`, so the placeholder is never
  hand-maintained ([agent-guidance](library/recipes/agent-guidance.md)).
- A gate's command exists in CI — `ci-workflow` / `ci-workflow-npm` run the gates, and their `requires`
  refuses to write a workflow that names a missing script
  ([ci-workflow](library/recipes/ci-workflow.md)).
- Drift between an owned file and its recipe — `plan.mjs --check`, surfaced by `ci-drift`
  ([ci-drift](library/recipes/ci-drift.md)).

**Enforceable, but not yet expressed — needs a new detector check or template:**

- "Every merged block is attributable to its recipe." This is a *template* rule, so it is review-time
  today: the contract says `detect.mjs` "MUST reject a recipe that breaks a **frontmatter** rule", while
  "A rule about a *template's contents* … is enforced at review time instead, because the detector reads
  frontmatter and never opens a template." The contract even names the model for closing the gap: "The
  cheap detector check for the day it does: open each `files[]` entry's template and refuse `{{root}}` in
  a `root`-scoped entry" ([RECIPE-CONTRACT.md](library/RECIPE-CONTRACT.md)). The same check extends to
  markers: refuse a `files[].action: merge` whose template lacks a
  `code-quality:<id>:start`/`:end` pair, or whose marker names an id other than the recipe's. Add it to
  `skills/code-quality-setup/scripts/detect.mjs`, not to a recipe.
- Nested per-member guidance. `agent-guidance` writes `AGENTS.md` with `scope: root` only, so the
  nearest-wins layering both harnesses document ([agents.md](https://agents.md/),
  [Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md)) is not expressible. New: a
  `member`-scoped entry in `agent-guidance` with a `memberMode: standalone` template, or a sibling
  recipe `agent-guidance-member` reusing the same `{{plan.gates}}` substitution.
- A cap on the `AGENTS.md` block. Mechanically checkable, but it should not be a `verify` line: "A recipe
  whose verify cannot pass on a pre-existing repo is missing an apply step, not a `verify` exception"
  ([RECIPE-CONTRACT.md](library/RECIPE-CONTRACT.md)). A repo whose `AGENTS.md` predates the recipe would
  fail closed and the recipe would never record. Emit it as a plan warning, the way `cost: heavy` prints
  one ([RECIPE-CONTRACT.md](library/RECIPE-CONTRACT.md)).

**Judgement — an instruction file, not a gate:**

- Whether a sentence earns its context load (the no-op test) and whether it is a cache of a lookup the
  agent could do itself ([skill://writing-for-agents](skill://writing-for-agents), Pruning).
- Whether a marker comment is valid in its target language. Partially gateable for the shell case
  (`sh -n` over a rendered `.husky/pre-commit` template, a `scripts/check-library.mjs` check), but not in
  general, because the detector does not parse the target language
  ([RECIPE-CONTRACT.md](library/RECIPE-CONTRACT.md)).
- The prose around the generated block — the invariant sentences in `docs/code-quality.md`, the pointer's
  wording. The pointer's wording "decides when the agent reaches the material, and how reliably"
  ([skill://writing-for-agents](skill://writing-for-agents), Context pointers); no gate reads it.

## Routing

| Practice | Gate can fail? | Where it goes |
|---|---|---|
| `AGENTS.md` carries the marker block; the pointer target exists | Yes | `agent-guidance` (`verify` already greps both) |
| The gate table and per-recipe detail are rendered from the selection, never hand-written | Yes | `agent-guidance` (`merge` + `create`; the template holds `{{plan.gates}}` / `{{plan.details}}`) |
| Every merged block is attributable to the recipe that owns it | Not yet — template rule, enforced at review time | New check in `skills/code-quality-setup/scripts/detect.mjs`: refuse a `merge` template without its own `code-quality:<id>:start`/`:end` pair. Contract precedent: the `{{root}}`-in-root-scope check |
| A marker comment is valid in the target language | Partially (shell case only) | `sh -n` over rendered shell templates in `scripts/check-library.mjs`; the general rule is `library/practices/merge-marker-comment-syntax.md` |
| Nested per-member `AGENTS.md` | Yes, once expressed | Extend `agent-guidance` with a `member`-scoped entry (`memberMode: standalone`), or add `agent-guidance-member` |
| A gate row's `run` names a script that exists | Yes | `ci-workflow` / `ci-workflow-npm` (`requires` the recipes whose scripts the workflow calls; conditional steps use step-level `if: hashFiles(...)`) |
| Drift between an owned file and its recipe | Yes | `ci-drift` (non-blocking sticky comment) + `plan.mjs --check` |
| A signal (drift, fallow health) is not presented as a gate | Yes, by construction | `ci-drift` (`continue-on-error`), `ci-workflow`'s `fallow-coverage` job |
| `AGENTS.md` stays within a readable size | Mechanically checkable, wrong as `verify` | Plan warning (like `cost: heavy`), plus `library/practices/agents-md-budget.md` |
| Whether a sentence earns its context load | No | `library/practices/instruction-no-op-test.md` |
| Whether prose duplicates a lookup the agent can do itself | No | `library/practices/environment-is-a-source-of-truth.md` |
| The pointer's wording, and the invariants around the generated block | No | `library/practices/context-pointer-wording.md` |
| A doc placed where the harness does not look (plugin-root `CLAUDE.md`, `CLAUDE.local.md` shadowing `AGENTS.md`) | Partially | `library/practices/harness-discovery-paths.md`; the plugin case is a `claude plugin validate` warning the author should treat as a gate |
