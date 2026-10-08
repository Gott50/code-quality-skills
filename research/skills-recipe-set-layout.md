# How comparable shipped skills structure a modular recipe set

Ticket: [#3](https://github.com/Gott50/code-quality-skill/issues/3) · Branch: `research/skills-recipe-set-layout` · Date: 2026-10-08

Answers the layout question for `code-quality-setup`: **should it be a thin `SKILL.md` plus per-recipe
reference files loaded on demand, and what is a defensible size budget for the top-level file?**

**Verdict: yes — thin `SKILL.md` (workflow + selection) plus one reference file per recipe, loaded on
demand. Target ≤200 lines / ≤2,000 words / ≤12 KB; hard ceiling 500 lines. Recipe files ≤300 lines each,
with a table of contents above 100 lines. Recipe applicability goes in machine-readable frontmatter that
`scripts/detect.mjs` evaluates, not in prose.**

---

## Method

Every number below is measured, not estimated. Sources:

- `vercel-labs/agent-skills`, `anthropics/skills`, `obra/superpowers` — read at `main` via
  `gh api repos/<r>/git/trees/main?recursive=1` (blob sizes) and `raw.githubusercontent.com` (contents),
  2026-10-08. 68 `SKILL.md` files measured across the four corpora.
- `mattpocock/skills` — the vendored copy at `.agents/skills/` in this repo (27 skills), no network.
- `vercel-labs/skills` (the CLI) — README and `src/installer.ts` at `main`.

Line counts are `wc -l`; byte counts are `wc -c`; word counts are whitespace-split.

---

## 1. Corpus at a glance

`SKILL.md` size, measured:

| Corpus | n | lines min / median / max | bytes median / max | words median / max | bytes per line (median) |
|---|---|---|---|---|---|
| `vercel-labs/agent-skills` | 9 | 39 / 149 / 353 | 7,251 / 17,311 | 948 / 2,130 | 36.7 |
| `anthropics/skills` | 18 | 6 / 114.5 / 485 | 8,335 / 33,168 | 1,176 / 5,205 | 49.7 |
| `obra/superpowers` | 14 | 65 / 215 / 681 | 8,623 / 32,577 | 1,354.5 / 4,871 | 37.7 |
| `mattpocock/skills` (local) | 27 | 7 / 71 / 170 | 4,123 / 12,594 | 574 / 2,075 | 62.8 |
| **all** | **68** | **6 / 108.5 / 681** | — | — | — |

Distribution across all 68: p25 = 59 lines, median = 108.5, p75 = 225. **48 of 68 (71%) are ≤200 lines.**
Only 2 of 68 exceed 500 lines (`obra/superpowers` `writing-skills` at 681 and
`subagent-driven-development` at 568); 11 of 68 exceed 300.

Reference material (non-`SKILL.md` `.md` under `skills/`), measured:

| Corpus | n | min / p25 / median / p75 / max bytes | >20 KB | 10–20 KB | 5–10 KB | 2–5 KB | <2 KB |
|---|---|---|---|---|---|---|---|
| vercel | 196 | 329 / 1,072 / 1,554 / 2,395 / 108,261 | 5 | 5 | 7 | 54 | 125 |
| anthropic | 110 | 235 / 1,723 / 9,288 / 19,786 / 316,954 | 26 | 26 | 17 | 11 | 30 |
| obra | 45 | 653 / 1,582 / 1,964 / 4,761 / 46,197 | 1 | 2 | 7 | 12 | 23 |

The vercel distribution is bimodal by design: ~125 small rule files (one rule each, <2 KB) plus a handful
of generated `AGENTS.md` compiled documents (22–108 KB). Anthropic's is the opposite — few, large,
domain-scoped reference files.

---

## 2. `vercel-labs/agent-skills`

### 2.1 The canonical thin-body + rule-files skill

`skills/react-best-practices/` — `SKILL.md` **149 lines / 7,251 B**, plus 72 files under `rules/`
(70 rule files at 532–4,423 B, `_sections.md` 46 L, `_template.md` 28 L), a generated `AGENTS.md`
(3,810 L / 108,261 B), `README.md`, `metadata.json`.

`SKILL.md` section structure, in order: frontmatter (`name`, `description`, `license`, `metadata.author`,
`metadata.version`) → `# Title` + one-paragraph abstract → `## When to Apply` (bullet list of triggers) →
`## Rule Categories by Priority` (table: priority / category / impact / filename prefix) →
`## Quick Reference` (every rule id + one-line description, grouped by category) → `## How to Use`
("Read individual rule files for detailed explanations and code examples: `rules/async-parallel.md` …")
→ `## Full Compiled Document` (pointer to `AGENTS.md`).

The `## Quick Reference` block is the routing index: 70 rule ids with one-line glosses, so the agent can
pick a rule file without opening any of them. `rules/_sections.md` holds the section metadata
(id, impact, description) that the build script uses to generate both `SKILL.md`'s tables and `AGENTS.md`.

`skills/composition-patterns/` is the same shape at smaller scale: **89 L / 2,886 B** + 8 rule files
(953–4,974 B) + `AGENTS.md` (946 L / 22,627 B). `skills/react-native-skills/` is **121 L / 4,439 B** +
36 rule files (697–4,941 B) + `AGENTS.md` (73,771 B).

### 2.2 The `references/` variant

`skills/react-view-transitions/` — `SKILL.md` **332 L / 14,407 B** + `references/` with 5 files
(`implementation.md` 170 L, `patterns.md` 274 L, `nextjs.md` 233 L, `css-recipes.md` 312 L,
`troubleshooting.md` 47 L) + generated `AGENTS.md` (58,993 B). Its `README.md` documents the split
explicitly:

```
react-view-transitions/
├── SKILL.md                      # Core skill (always loaded)
├── AGENTS.md                     # Full compiled document (all references expanded)
└── references/
    ├── implementation.md         # Step-by-step implementation workflow
    ├── patterns.md               # Real-world patterns and events API
    ├── troubleshooting.md        # Symptom-driven debugging
    ├── nextjs.md                 # Next.js-specific patterns
    └── css-recipes.md            # Copy-paste CSS animations
```

### 2.3 The pipeline skill with a detector — closest structural analogue

`skills/vercel-optimize/` is the nearest thing in the corpus to what `code-quality-setup` will be:
audit → select candidates deterministically → investigate → apply. Measured: `SKILL.md` **322 L /
17,311 B**; `references/` 9 top-level markdown docs (3,731–20,925 B) + `docs-library.json` (31,540 B) +
`playbooks/` (README + 7 playbooks, 2,485–4,019 B) + `support-topics/` (README + 42 topics, 906–1,419 B
each, median 1,119); `lib/` 75 `.mjs` modules; `scripts/` 15 `.mjs` entry points; `AGENTS.md` 1,964 B;
`README.md` 4,471 B; `CONTRIBUTING.md` 2,224 B. Whole directory: **827,340 B across 156 files**.

`SKILL.md` structure: frontmatter → `# Title` → core doctrine (5 bullets, each with a pointer) →
`## Prerequisites` → `## Framework Support` (table) → `## Run Directory` → `## Pipeline` (4 top-level
steps with 5 sub-steps — 1, 1.1, 2, 2.1, 2.2, 2.3, 2.4, 3, 4 — each a fenced `bash` block plus a pointer
to the reference that explains it) → `## Recommendation Rules` → `## Scanner Rules` →
`## Final Customer Terms` → `## Failure Copy`.

The body is a **procedure with pointers**, not a content dump. Every step delegates its detail:
"Collection details, schemas, metric IDs, and degradation behavior live in
[references/data-collection.md](references/data-collection.md)"; "Core doctrine: read
[references/doctrine.md](references/doctrine.md) if any rule is unclear"; "Customer copy. Read
[references/voice.md](references/voice.md) before writing report text or chat output."

### 2.4 Machine-checkable applicability — the one real precedent

`references/support-topics/*.md` carry a **strict YAML frontmatter contract** that a script evaluates.
From `references/support-topics/README.md`:

```md
---
id: cdn-cache-auth-safety
title: CDN cache auth safety
status: active
candidateKinds: ["uncached_route", "cache_header_gap"]
frameworks: ["*"]
priority: 90
citations: ["https://vercel.com/docs/caching/cdn-cache"]
maxBriefChars: 900
---
```

Rules stated there: "Every active topic must cite only URLs or skill-rule refs already present in
`references/docs-library.json`"; "Use `candidateKinds` to keep the topic narrow. Use `"*"` only for
workflow/protocol topics that truly apply to every candidate"; optional `metrics` (`["LCP"]`, `["INP"]`,
`["CLS"]`) and `routePatterns` (JS regex source strings); "Keep the body below `maxBriefChars`; the brief
renderer caps selected topics before they reach the sub-agent."

`lib/support-topics.mjs` (355 L) is the selector: it parses the frontmatter, then filters on
`matchesCandidateKind`, `matchesFrameworks`, `matchesOptionalList`, `matchesRouter`,
`matchesCandidateMetrics`, `matchesCandidateRoutePatterns`, `matchesScannerPatterns`, and
`topicCitationsApply`. It enforces `SUPPORT_TOPIC_LIMIT = 3` and
`SUPPORT_TOPIC_TOTAL_CHAR_LIMIT = 2400`, and exposes `validateSupportTopics()`.

Two more deterministic gates:

- `lib/framework-support.mjs` (67 L) — `classifyFrameworkSupport(stack)` returns
  `{ok, status: 'supported'|'limited'|'unsupported', blocker, framework, label, detail}` from a detected
  framework string. `CORE_SUPPORTED_FRAMEWORKS = ['next','sveltekit','nuxt']`,
  `LIMITED_FRAMEWORKS = ['astro']`. The `SKILL.md` then branches on `frameworkSupportBlocker ===
  "unsupported_framework"` with a fixed prompt.
- `references/playbooks/README.md` — a signal→profile detection table (`@vercel/sandbox`, `@ai-sdk/*`,
  `ai`, `openai`, `@anthropic-ai/sdk` → `ai-application`; `stripe`, `@shopify/*` → `ecommerce`; …), with
  "When detection is uncertain, no playbook is applied. The recommender works fine without one — the
  playbook is a tilt, not a requirement."

`skills/react-best-practices/rules/*.md` also carry frontmatter (`title`, `impact`,
`impactDescription`, `tags`) but that is **content** validation, not applicability:
`packages/react-best-practices-build/src/validate.ts` (110 L) enforces non-empty title/explanation, at
least one code example, and at least one bad/incorrect or good/correct example, and restricts `impact` to
`CRITICAL | HIGH | MEDIUM-HIGH | MEDIUM | LOW-MEDIUM | LOW`.

### 2.5 Scripts

`vercel-optimize` ships 15 `.mjs` entry points under `scripts/` and ~50 `.mjs` modules under `lib/`.
**Every import is a Node builtin or a sibling module** — the complete set of import specifiers across
`scripts/*.mjs` and `lib/*.mjs` is `node:fs/promises`, `node:path`, `node:url`, plus relative
`./citations.mjs`, `./gates/index.mjs`, `./gates/scanner-driven.mjs`, `../lib/verify-claim.mjs`. There is
no `package.json` in the skill directory. Invocation is always an explicit interpreter call in a fenced
block: `node scripts/collect-signals.mjs [projectId] > "$RUN_DIR/vercel-signals.json" 2> …`.

`scripts/verify-finding.mjs` (19 L) is the minimal shape: a CLI shell that reads `process.argv[2]` as
JSON, calls `verifyClaim` from `../lib/verify-claim.mjs`, writes JSON to stdout, and exits 1 with a
`[verify-finding] FAILED:` line on stderr.

`lib/util.mjs` (17 L) states the maintenance rule for shared helpers: "Shared scanner + sanitizer
helpers. **Keep tiny — add only when duplicated 3+ times.**"

`skills/deploy-to-vercel/resources/deploy.sh` (301 L) is the bash equivalent: `set -euo pipefail`, `curl`
to a deploy endpoint, framework detection by grepping `package.json`. No dependencies beyond coreutils.

`skills/web-design-guidelines/SKILL.md` (39 L / 1,231 B) and `skills/writing-guidelines/SKILL.md`
(39 L / 1,233 B) are the zero-bundle extreme: the body is a 4-step procedure that fetches the rules from
a `raw.githubusercontent.com` URL at run time. Not applicable to us (our recipes must work offline), but
it establishes that a 39-line `SKILL.md` is a legitimate shipped skill.

### 2.6 Stated structure convention

`README.md` § Skill Structure: "Each skill contains: `SKILL.md` - Instructions for the agent; `scripts/` -
Helper scripts for automation (optional); `references/` - Supporting documentation (optional)."

---

## 3. `anthropics/skills`

### 3.1 The published size budget

`skills/skill-creator/SKILL.md` (**485 L / 33,168 B / 5,205 words** — the largest word count in the
corpus) states the three-level model:

> Skills use a three-level loading system:
> 1. **Metadata** (name + description) - Always in context (~100 words)
> 2. **SKILL.md body** - In context whenever skill triggers (<500 lines ideal)
> 3. **Bundled resources** - As needed (unlimited, scripts can execute without loading)
>
> These word counts are approximate and you can feel free to go longer if needed.
>
> **Key patterns:**
> - Keep SKILL.md under 500 lines; if you're approaching this limit, add an additional layer of hierarchy
>   along with clear pointers about where the model using the skill should go next to follow up.
> - Reference files clearly from SKILL.md with guidance on when to read them
> - For large reference files (>300 lines), include a table of contents

And the domain-variant layout, which is our case verbatim:

> **Domain organization**: When a skill supports multiple domains/frameworks, organize by variant:
> ```
> cloud-deploy/
> ├── SKILL.md (workflow + selection)
> └── references/
>     ├── aws.md
>     ├── gcp.md
>     └── azure.md
> ```
> Claude reads only the relevant reference file.

The same numbers appear in Anthropic's published authoring guide
([best-practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices),
fetched live 2026-10-08, 42,028 B): "Keep SKILL.md body under 500 lines for optimal performance. If your
content exceeds this, split it into separate files using the progressive disclosure patterns described
earlier." (appears twice, in § Progressive disclosure patterns and § Token budgets), plus:

- "**Keep references one level deep from SKILL.md**. All reference files should link directly from
  SKILL.md to ensure Claude reads complete files when needed." — with the failure mode named: "Agents may
  partially read files when they're referenced from other referenced files. When encountering nested
  references, an agent might use commands like `head -100` to preview content rather than reading entire
  files, resulting in incomplete information."
- "For reference files longer than 100 lines, include a table of contents at the top. This ensures Claude
  can see the full scope of available information even when previewing with partial reads."
- Checklist item: "SKILL.md body is under 500 lines"; "File references are one level deep"; "Progressive
  disclosure used appropriately".

The guide's three named patterns are: **Pattern 1** high-level guide with references (`FORMS.md`,
`REFERENCE.md`, `EXAMPLES.md`); **Pattern 2** domain-specific organization (`reference/finance.md`,
`reference/sales.md`, …); **Pattern 3** conditional details ("For tracked changes: See REDLINING.md").

### 3.2 Observed sizes

| Skill | `SKILL.md` | Siblings |
|---|---|---|
| `template` | 6 L / 140 B | none — the bare scaffold |
| `internal-comms` | 32 L / 1,511 B | `examples/` 4 md (602–3,295 B) |
| `theme-factory` | 59 L / 3,124 B | `themes/` 10 md (496–558 B), `theme-showcase.pdf` (124,310 B) |
| `frontend-design` | 71 L / 9,390 B | `LICENSE.txt` only |
| `web-artifacts-builder` | 73 L / 3,087 B | `scripts/` 2 sh + `shadcn-components.tar.gz` |
| `brand-guidelines` | 73 L / 2,235 B | — |
| `docx` | 91 L / 6,911 B | `scripts/` (Python) |
| `webapp-testing` | 95 L / 3,913 B | `examples/` 3 py, `scripts/with_server.py` (105 L) |
| `xlsx` | 99 L / 8,598 B | `scripts/` (Python) |
| `mcp-builder` | 236 L / 9,092 B | `reference/` 4 md (7,330–28,550 B), `scripts/` 2 py + XML fixture + `requirements.txt` |
| `pptx` | 238 L / 20,796 B | `scripts/` (Python + XSD schemas) |
| `pdf` | 314 L / 8,072 B | `forms.md` (294 L), `reference.md` (611 L), `scripts/` 8 py |
| `skill-creator` | 485 L / 33,168 B | `agents/` 3 md, `assets/`, `eval-viewer/` 2, `references/schemas.md` (430 L), `scripts/` 9 py |

`frontend-design` is the notable outlier: **71 lines / 9,390 B** with no reference files at all — a
single dense prose document. It is a *judgement* skill (aesthetic direction), not a procedure with
branches, so there is nothing to disclose. That is the counter-case to over-splitting.

### 3.3 Routing patterns

- **Type→file mapping** (`internal-comms`, 32 L): "1. **Identify the communication type** from the
  request. 2. **Load the appropriate guideline file** from the `examples/` directory: -
  `examples/3p-updates.md` - For Progress/Plans/Problems team updates - `examples/company-newsletter.md` -
  For company-wide newsletters - `examples/faq-answers.md` - For answering frequently asked questions -
  `examples/general-comms.md` - For anything else that doesn't explicitly match one of the above."
- **Phase-tagged load list** (`mcp-builder`): a `# Reference Files` section with `### Core MCP
  Documentation (Load First)`, `### SDK Documentation (Load During Phase 1/2)`, `### Language-Specific
  Implementation Guides (Load During Phase 2)`, `### Evaluation Guide (Load During Phase 4)`. Each entry
  is a link plus a bulleted inventory of what the file contains.
- **Inline at point of use** (`pdf`): "For advanced features, JavaScript libraries, and detailed examples,
  see REFERENCE.md. If you need to fill out a PDF form, read FORMS.md and follow its instructions."
- **Subagent-scoped** (`skill-creator`): "The agents/ directory contains instructions for specialized
  subagents. Read them when you need to spawn the relevant subagent."

### 3.4 Scripts

Anthropic does **not** keep scripts dependency-free. `mcp-builder/scripts/requirements.txt` is
`anthropic>=0.39.0` / `mcp>=1.1.0`; `slack-gif-creator/requirements.txt` is `pillow>=10.0.0` /
`imageio>=2.31.0` / `imageio-ffmpeg>=0.4.9` / `numpy>=1.24.0`. The guide's § Package dependencies says
claude.ai can install from npm/PyPI while the Anthropic API "has no network access and no runtime package
installation", and instructs listing required packages in `SKILL.md`.

The invocation convention is stated in `webapp-testing/SKILL.md` (95 L) and is the strongest statement of
the black-box rule in the corpus:

> **Always run scripts with `--help` first** to see usage. DO NOT read the source until you try running
> the script first and find that a customized solution is abslutely necessary. These scripts can be very
> large and thus pollute your context window. They exist to be called directly as black-box scripts rather
> than ingested into your context window.

The guide's § Provide utility scripts gives the reason: "More reliable than generated code; Save tokens
(no need to include code in context); Save time (no code generation required); Ensure consistency across
uses", and requires the body to distinguish **execute** ("Run `analyze_form.py` to extract fields") from
**read as reference** ("See `analyze_form.py` for the field extraction algorithm").

The guide also names the **plan-validate-execute** pattern — "have the agent first create a plan in a
structured format, then validate that plan with a script before executing it" — with the rationale
"Catches errors early; Machine-verifiable; Reversible planning; Clear debugging", recommended for "Batch
operations, destructive changes, complex validation rules, high-stakes operations." That is exactly the
audit → print plan → apply-on-approval shape already decided for `code-quality-setup`.

### 3.5 Machine-checkable applicability

**None.** No Anthropic skill declares applicability conditions in frontmatter. Selection is prose
judgement in the body (`internal-comms`'s type mapping, `mcp-builder`'s phase tags). The only
machine-checked artefact is `skill-creator`'s eval harness (`evals/evals.json` with an `assertions` field,
`grading.json` with `text`/`passed`/`evidence`), which validates the skill's *output*, not its
applicability.

---

## 4. `obra/superpowers`

### 4.1 Sizes

| Skill | `SKILL.md` | Siblings |
|---|---|---|
| `using-superpowers` | 65 L / 3,192 B | `references/` 7 platform files (1,242–4,762 B) |
| `requesting-code-review` | 95 L / 2,977 B | `code-reviewer.md` (6,449 B) |
| `verification-before-completion` | 120 L / 3,646 B | — |
| `dispatching-parallel-agents` | 167 L / 6,078 B | — |
| `using-git-worktrees` | 167 L / 6,813 B | — |
| `writing-plans` | 204 L / 10,335 B | — |
| `receiving-code-review` | 205 L / 6,203 B | — |
| `finishing-a-development-branch` | 225 L / 7,781 B | — |
| `systematic-debugging` | 283 L / 9,465 B | 10 files: `root-cause-tracing.md`, `defense-in-depth.md`, `condition-based-waiting.md` (115 L), `condition-based-waiting-example.ts`, `find-polluter.sh` (72 L), `CREATION-LOG.md`, 4 `test-*.md` |
| `brainstorming` | 285 L / 17,548 B | `visual-companion.md` (299 L), `spec-document-reviewer-prompt.md`, `scripts/` 5 (incl. `server.cjs` 723 L) |
| `test-driven-development` | 330 L / 9,578 B | `writing-good-tests.md` (8,268 B) |
| `executing-plans` | 373 L / 20,405 B | `scripts/task-start` (28 L), `scripts/task-done` (52 L) |
| `subagent-driven-development` | 568 L / 32,577 B | 3 prompt templates, `scripts/` 3 |
| `writing-skills` | 681 L / 26,623 B | `anthropic-best-practices.md` (1,150 L / 46,197 B), `testing-skills-with-subagents.md` (384 L), `persuasion-principles.md`, `graphviz-conventions.dot`, `render-graphs.js` (169 L), `examples/CLAUDE_MD_TESTING.md` |

### 4.2 The stated split rule

`writing-skills/SKILL.md` § Directory Structure is the most explicit rule in the corpus:

> **Separate files for:**
> 1. **Heavy reference** (100+ lines) - API docs, comprehensive syntax
> 2. **Reusable tools** - Scripts, utilities, templates
>
> **Keep inline:**
> - Principles and concepts
> - Code patterns (< 50 lines)
> - Everything else

with three named shapes: *Self-Contained Skill* (`SKILL.md` only), *Skill with Reusable Tool*
(`SKILL.md` + `example.ts`), *Skill with Heavy Reference* (`SKILL.md` + `pptxgenjs.md` 600 L +
`ooxml.md` 500 L + `scripts/`).

It also states the token-efficiency targets: "getting-started workflows: <150 words each; Frequently-loaded
skills: <200 words total; Other skills: <500 words (still be concise)", with a `wc -w` verification step.
Note these are far tighter than what the corpus actually ships (median 1,354 words) — they are targets for
always-loaded skills, not for on-demand ones.

And the anti-`@`-link rule: "**Why no @ links:** `@` syntax force-loads files immediately, consuming 200k+
context before you need them." Cross-references use the skill name only, with explicit requirement
markers (`**REQUIRED SUB-SKILL:** Use superpowers:test-driven-development`).

### 4.3 Routing patterns

- **Platform table → reference file** (`using-superpowers`, 65 L): "If your harness appears here, read its
  reference file for special instructions: - Claude Code: `references/claude-code-tools.md` - Codex:
  `references/codex-tools.md` - Pi: `references/pi-tools.md` …" — 7 branches, one file each, one line each.
- **Inline at point of use** (`systematic-debugging`): "See `root-cause-tracing.md` in this directory for
  the complete backward tracing technique." and a closing `## Supporting Techniques` list: "These
  techniques are part of systematic debugging and available in this directory: -
  **`root-cause-tracing.md`** - Trace bugs backward through call stack to find original trigger -
  **`defense-in-depth.md`** - Add validation at multiple layers after finding root cause -
  **`condition-based-waiting.md`** - Replace arbitrary timeouts with condition polling".
- **Template pointer** (`subagent-driven-development`): "Template: [implementer-prompt.md](implementer-prompt.md)"
  at the end of the step that dispatches an implementer.

### 4.4 Scripts

Bash + coreutils, or zero-dependency Node. `scripts/task-start` (28 L) is `#!/usr/bin/env bash` +
`set -euo pipefail`, delegating to a sibling script and `git rev-parse HEAD`. `scripts/sdd-workspace`
(82 L) is pure bash (`git rev-parse --show-toplevel`, `mkdir -p`, `printf`). `find-polluter.sh` (72 L) is
bash + `find` + `npm test`. `brainstorming/scripts/server.cjs` (723 L) is a Node server with no
`package.json` in the skill directory.

The invocation rule is stated in `writing-skills`:

> Invoke bundled scripts through their interpreter in the prose (`bash scripts/tool.sh`,
> `node scripts/tool.js`), never by bare path: some harness plugin packagers strip executable bits, and a
> bare `scripts/tool.sh` fails there with `Permission denied`.

### 4.5 Machine-checkable applicability

**None.** `using-superpowers` uses a prose platform table. `writing-skills` states the general principle
that argues *for* machine-checking where possible: "Don't create for: … Mechanical constraints (if it's
enforceable with regex/validation, automate it—save documentation for judgment calls)."

`writing-skills` also carries the corpus's most useful taxonomy for our case — **Match the Form to the
Failure**:

| Baseline failure | Right form | Wrong form |
|---|---|---|
| Skips/violates a rule under pressure | Prohibition + rationalization table + red flags | Soft guidance ("prefer…", "consider…") |
| Complies, but output has the wrong shape | Positive recipe or contract: state what the output IS — its parts, in order | Prohibition list |
| Omits a required element from something they already produce | Structural: REQUIRED field or slot in the template they fill in | Prose reminders near the template |
| Behavior should depend on a condition | **Conditional keyed to an observable predicate** ("if the brief exists, reference it") | Unconditional rule + exemption clauses |

Our recipe selection is the fourth row: a conditional keyed to an observable predicate. That is the
argument for `detect.mjs` producing the predicate rather than the agent judging in prose.

---

## 5. `mattpocock/skills` (vendored locally at `.agents/skills/`)

### 5.1 Sizes

27 skills. `SKILL.md` **7–170 lines, 157–12,594 B, median 71 L / 4,123 B / 574 words** — the tightest
corpus by every measure, and the densest (62.8 B/line median vs 36.7 for vercel).

| Skill | `SKILL.md` | Sibling files |
|---|---|---|
| `grill-me`, `grill-with-docs`, `wait-what` | 7 L | — |
| `research` | 12 L / 794 B | — |
| `handoff` | 16 L / 940 B | — |
| `implement` | 17 L / 622 B | — |
| `prototype` | 26 L / 2,931 B | `LOGIC.md`, `UI.md` |
| `grilling` | 30 L / 2,049 B | — |
| `tdd` | 38 L / 3,629 B | `tests.md`, `mocking.md` |
| `implement-spec` | 40 L / 2,780 B | — |
| `wizard` | 44 L / 4,123 B | `template.sh` |
| `retro` | 44 L / 4,369 B | — |
| `to-questionnaire` | 54 L / 2,904 B | — |
| `code-review` | 89 L / 6,670 B | — |
| `ask-matt` | 97 L / 12,594 B | `PHASE-BOUNDARIES.md` |
| `to-tickets` | 105 L / 5,812 B | — |
| `triage` | 112 L / 6,558 B | `AGENT-BRIEF.md`, `OUT-OF-SCOPE.md` |
| `codebase-design` | 114 L / 6,446 B | `DEEPENING.md`, `DESIGN-IT-TWICE.md` |
| **`setup-matt-pocock-skills`** | **118 L / 6,978 B** | **5 seed templates** |
| `wayfinder` | 128 L / 12,380 B | — |
| `diagnosing-bugs` | 138 L / 8,664 B | `scripts/hitl-loop.template.sh` |
| `teach` | 140 L / 9,733 B | 4 `*-FORMAT.md` |
| `pr` | 170 L / 4,169 B | `CREDITS.md` |

12 of 27 skills have sibling files; 15 are single-file. The largest `SKILL.md` in the whole corpus of 27
is 170 lines.

### 5.2 The closest analogue: `setup-matt-pocock-skills`

**118 L / 6,978 B** + 5 sibling reference files (`issue-tracker-github.md`, `issue-tracker-gitlab.md`,
`issue-tracker-local.md`, `triage-labels.md`, `domain.md`). Same shape as `code-quality-setup`: explore
the repo, present findings, confirm with the user, write config + agent guidance.

Its structure: frontmatter (`name`, `description`, `disable-model-invocation: true`) → `# Title` →
one-paragraph scope + "This is a prompt-driven skill, not a deterministic script. Explore, present what
you found, confirm with the user, then write." → `## Process` with numbered steps `### 1. Explore`
(bulleted observable checks: `git remote -v`, does `AGENTS.md`/`CLAUDE.md` exist, is the `triage` skill
installed, monorepo signals) → `### 2. Present findings and ask` (Section A/B/C, each with a
recommended default and a skip condition) → `### 3. Confirm and edit` → `### 4. Write` (file-selection
rules + the exact block to insert) → `### 5. Done`.

The seed-template pointer is the pattern we want:

> Then write the docs files using the seed templates in this skill folder as a starting point:
> - [issue-tracker-github.md](./issue-tracker-github.md): GitHub issue tracker
> - [issue-tracker-gitlab.md](./issue-tracker-gitlab.md): GitLab issue tracker
> - [issue-tracker-local.md](./issue-tracker-local.md): local-markdown issue tracker
> - [triage-labels.md](./triage-labels.md): label mapping (only if `triage` is installed)
> - [domain.md](./domain.md): domain doc consumer rules + layout

Note the parenthetical guard on `triage-labels.md` — a per-file load condition, one line each.

### 5.3 The repo's own convention doc

`writing-for-agents/SKILL.md` (81 L / 10,886 B) + `SKILL-MECHANICS.md` is the repo's stated doctrine and
is directly applicable. Key levers, quoted:

- **Information hierarchy**: "1. **In-file step** is the primary tier: what the agent does, in order.
  2. **In-file reference** is consulted on demand. 3. **Disclosed reference** is pushed out into a
  separate file, reached by a context pointer, loaded only when the pointer fires."
- **The disclosure test**: "**Branching is the cleanest disclosure test: inline what every branch needs,
  and push behind a pointer what only some branches reach.** When a document has steps, in-file reference
  that should be disclosed buries them and turns attending to them into a coin-flip: a variance lever,
  not just a legibility one."
- **Sprawl**: "a document simply too long, even when every line is live and unique. Attention thins
  across the excess… The cure is the ladder: disclose reference behind pointers, and split by branch or
  sequence so each path carries only what it needs."
- **Pointer wording**: "A must-have target behind a weakly worded pointer is a variance bug: sharpen the
  wording first, and inline the material only if sharpening fails." And: "**One trigger per branch.**
  Synonyms that rename a single branch are one branch written twice; collapse them and keep only
  genuinely distinct branches."
- **Two loads**: "**Context load** is the cost of always-loaded material on the agent's window… **Cognitive
  load** is the cost on the human: which documents exist and when to reach for each."
- **Invocation** (`SKILL-MECHANICS.md`): a model-invoked skill keeps a `description` and pays permanent
  context load; a user-invoked skill sets `disable-model-invocation: true` and pays zero context load but
  spends cognitive load. "Pick model-invocation only when the agent must reach the skill on its own, or
  another skill must."

### 5.4 Routing pattern

Uniform across the repo: **branch-first pointer with a colon gloss**, one line per branch.

- `codebase-design`: "- **Deepening a cluster given its dependencies**, see [DEEPENING.md](DEEPENING.md):
  dependency categories, seam discipline, and replace-don't-layer testing. - **Exploring alternative
  interfaces**, see [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md): spin up parallel sub-agents to design the
  interface several radically different ways, then compare on depth, locality, and seam placement."
- `prototype`: "- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md). Build a single
  shareable HTML file… - **"What should this look like?"** → [UI.md](UI.md). Generate several radically
  different UI variations…" followed by "The two branches produce very different artifacts, so getting
  this wrong wastes the whole prototype."
- `tdd`: "See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines."
- `domain-modeling`: "Use the format in [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md)." / "Use the format in
  [ADR-FORMAT.md](./ADR-FORMAT.md)."

### 5.5 Scripts

Two bash scripts only: `wizard/template.sh` and `diagnosing-bugs/scripts/hitl-loop.template.sh`. No Node
scripts. `wizard/SKILL.md` (44 L) is the "ship a template, not a generator" pattern: "The delightful UX is
already solved by [template.sh](template.sh): stage-by-stage progress, confirmation gates, cross-platform
URL opening (including WSL), hidden secret entry, idempotent `.env` upserts, `gh secret`/`gh variable`
writes, and a closing summary. **Your job is only to scope the procedure and author its stages.** The
library above the `STAGES` marker is identical in every wizard; that consistency is the point: never
hand-edit it."

### 5.6 Machine-checkable applicability

**None in frontmatter.** `setup-matt-pocock-skills` uses prose exploration conditions ("Is the `triage`
skill installed? (a `triage` skill folder alongside this one, or `triage` in your available skills.) This
decides whether Section B runs at all."). But `writing-for-agents` names the target form: "Conditional
keyed to an observable predicate ('if the brief exists, reference it')" — and `setup-matt-pocock-skills`
does key its skips to observable predicates (monorepo signals present/absent, `triage` installed/not).

---

## 6. Cross-cutting findings

### 6.1 `SKILL.md` size and section structure

Every corpus converges on the same skeleton, in this order:

1. YAML frontmatter — `name` + `description` required; `license`, `metadata.author`, `metadata.version`,
   `argument-hint`, `disable-model-invocation` optional.
2. `# Title` + a one-paragraph abstract stating what the skill covers.
3. A **when-to-apply** section — bullet list of triggers (`react-best-practices` `## When to Apply`,
   `composition-patterns` `## When to Apply`, `systematic-debugging` `## When to Use` with a "Use this
   ESPECIALLY when" sub-list).
4. A **selection or priority table** when there is more than one branch
   (`react-best-practices` priority table; `vercel-optimize` `## Framework Support`; `using-superpowers`
   platform table; `internal-comms` type list).
5. The **procedure** — numbered steps, each ending on a completion criterion.
6. A **routing section** — the pointer list to reference files.
7. Optional: `## Common Mistakes` / `## Red Flags` / rationalization table (obra's discipline skills),
   `## Quick Reference` (vercel), `## Full Compiled Document` (vercel).

The `description` field is the top-level pointer and is written for triggering, not for summarising.
`writing-skills` is emphatic: "**CRITICAL: Description = When to Use, NOT What the Skill Does**… Testing
revealed that when a description summarizes the skill's workflow, an agent may follow the description
instead of reading the full skill content." Anthropic's guide says the opposite for *pushiness* ("please
make the skill descriptions a little bit 'pushy'") but agrees the description carries the trigger
conditions. The `skills` CLI requires only `name` + `description`, and `name` must equal the parent
directory name.

### 6.2 How large reference material is split

Three shapes, all present in the corpus:

| Shape | Example | Split unit | Typical file size |
|---|---|---|---|
| **One file per rule** | `react-best-practices/rules/*.md` (70 files) | a single rule | 532–4,423 B |
| **One file per domain/variant** | `react-view-transitions/references/*.md` (5), `mcp-builder/reference/*.md` (4), `using-superpowers/references/*.md` (7), `theme-factory/themes/*.md` (10) | a branch the agent takes | 0.5–28.5 KB |
| **One file per topic, machine-selected** | `vercel-optimize/references/support-topics/*.md` (42) | a candidate class | 906–1,419 B each, capped at `maxBriefChars: 900` |

Plus the **generated compiled document** (`AGENTS.md`, 22–108 KB in vercel) which is *not* loaded by the
agent on demand — it is the "all references expanded" artefact for humans and other harnesses, pointed at
from `SKILL.md`'s last section.

The rule of thumb the corpus actually follows: **split when the material is reached by only some
branches; keep inline when every branch needs it.** Anthropic's guide states the same as Pattern 2
("organize content by domain to avoid loading irrelevant context… This keeps token usage low and context
focused") and `writing-for-agents` states it as the branching test.

### 6.3 Machine-checkable applicability conditions

**One corpus has them: `vercel-labs/agent-skills`.** The mechanism is a strict YAML frontmatter contract
on each reference file plus a Node selector that filters on it:

| Field | Meaning | Evaluated by |
|---|---|---|
| `candidateKinds` | which candidate classes the topic applies to | `matchesCandidateKind` |
| `frameworks` | framework allowlist, `["*"]` for universal | `matchesFrameworks` |
| `metrics` | candidate metric allowlist (`LCP`/`INP`/`CLS`) | `matchesCandidateMetrics` |
| `routePatterns` | JS regex source strings on the route | `matchesCandidateRoutePatterns` |
| `priority` | ordering when more than the cap match | sort |
| `maxBriefChars` | per-file body cap | renderer |
| `citations` | must resolve in `docs-library.json` | `topicCitationsApply` |
| `status` | `active` / draft | `loadSupportTopics({includeDraft})` |

Plus a pure classifier (`classifyFrameworkSupport`) and a signal→profile table. The selector enforces a
cap (`SUPPORT_TOPIC_LIMIT = 3`, `SUPPORT_TOPIC_TOTAL_CHAR_LIMIT = 2400`) so a broad match cannot flood
the context.

The other three corpora use prose judgement. `obra` and `mattpocock` both name the machine-checkable form
as the *preferred* one where it is available (`writing-skills`: "if it's enforceable with
regex/validation, automate it—save documentation for judgment calls"; `writing-for-agents`: "Conditional
keyed to an observable predicate").

### 6.4 Executable scripts

| Corpus | Language | Dependencies | Invocation |
|---|---|---|---|
| vercel | `.mjs` (Node) + `.sh` | **Node builtins only**; no `package.json` in the skill dir | `node scripts/x.mjs …` in a fenced block |
| anthropic | `.py` | **declared** in `requirements.txt` (`anthropic`, `mcp`, `pillow`, `numpy`, …) | `python scripts/x.py …`; "run with `--help` first, do not read the source" |
| obra | `.sh` + `.cjs` | bash/coreutils; zero-dep Node | `bash scripts/x.sh` / `node scripts/x.js` — **never a bare path** |
| mattpocock | `.sh` | bash/coreutils | `bash template.sh` |

The dependency-free recipe, as practised by vercel-optimize: `.mjs` extension, `node:`-prefixed builtin
imports only, no `package.json`, a thin CLI shell per entry point that reads `process.argv` and writes
JSON to stdout, and shared helpers in `lib/` kept tiny ("add only when duplicated 3+ times"). Scripts are
executed, not read — Anthropic's guide: "Utility scripts can be executed via bash without loading their
full contents into context. Only the script's output consumes tokens."

### 6.5 How the body tells the agent which reference file to load when

Ranked by how well they survive a weak model:

1. **Routing table with an explicit condition column** — `internal-comms` (type → file),
   `using-superpowers` (harness → file), `react-best-practices` (rule id → file, via `## Quick
   Reference`). One row per branch, condition first.
2. **Branch-first pointer with a colon gloss** — mattpocock's uniform style: `- **<branch>**, see
   [FILE](FILE): <what's inside>.` The branch is the trigger; the gloss lets the agent confirm without
   opening the file.
3. **Phase-tagged load list** — `mcp-builder`'s `(Load First)` / `(Load During Phase 2)` markers.
4. **Inline at the point of use** — `react-view-transitions` ("follow references/implementation.md step
   by step"), `systematic-debugging` ("See `root-cause-tracing.md` in this directory for…").
5. **Conditional guard** — `vercel-optimize` ("read references/doctrine.md **if any rule is unclear**";
   "Read references/voice.md **before writing report text**").

The corpus's own stated requirement is that the pointer must carry the condition, not just the path:
Anthropic's guide — "Reference files clearly from SKILL.md **with guidance on when to read them**";
`writing-for-agents` — "A pointer does two jobs: state what the material is, and list the **branches**
that should trigger reaching it."

---

## 7. Recommendation for `code-quality-setup`

### 7.1 Layout — yes, thin `SKILL.md` + per-recipe reference files

Adopt the shape Anthropic's guide names for exactly this case — "`SKILL.md` (workflow + selection)" plus
per-variant reference files, "Claude reads only the relevant reference file" — and that `vercel-optimize`
practises at scale.

```
skills/code-quality-setup/
├── SKILL.md                 # workflow + selection: audit → propose → apply
├── recipes/
│   ├── <recipe-id>.md       # one recipe per file: contract + applicability frontmatter
│   └── ...
├── files/                   # per-recipe templates, referenced from the recipe file
│   └── <recipe-id>/...
└── scripts/
    └── detect.mjs           # dependency-free detector; emits the applicability facts
```

Justification, each point grounded above:

- **The recipes are branches, not shared content.** A Bun project never needs the npm recipe; a
  single-package repo never needs the monorepo recipe. `writing-for-agents`: "inline what every branch
  needs, and push behind a pointer what only some branches reach." Anthropic Pattern 2: "organize content
  by domain to avoid loading irrelevant context."
- **The corpus's own size data says a body this shape lands at 100–330 lines.** The two closest analogues
  are `setup-matt-pocock-skills` (118 L, explore→present→confirm→write with 5 seed templates) and
  `vercel-optimize` (322 L, a 4-step pipeline with 5 sub-steps, 9 top-level reference docs and 15
  scripts). Our procedure is closer to the former in shape and to the latter in having a detector.
- **The CLI ships the whole directory.** `src/installer.ts` `copyDirectory` recurses the skill directory
  and copies every entry (`cp(srcPath, destPath, {dereference: true, recursive: true})`), so `recipes/`,
  `files/` and `scripts/` travel with the skill at no extra install cost. The only hard limits are the
  direct-URL download caps in the README — 10 MiB download, 25 MiB extracted, 1000 files — and
  `vercel-optimize` already ships 827 KB / 156 files, so a recipe library has ample headroom.
- **Keep references one level deep.** Anthropic's guide: "All reference files should link directly from
  SKILL.md." So `SKILL.md` must link each `recipes/<id>.md` directly — do not route through a
  `recipes/README.md` index that `SKILL.md` links to. (A `recipes/README.md` may exist as a
  contributor-facing schema doc, as `vercel-optimize` does for `playbooks/` and `support-topics/`, but it
  must not be the agent's only path to a recipe.)
- **Do not split further.** `frontend-design` (71 L, no references) is the counter-case: a skill whose
  content is judgement rather than branches stays a single file. The audit/propose/apply procedure itself
  is shared by every branch and belongs inline.

### 7.2 Size budget for the top-level `SKILL.md`

**Target: ≤200 lines, ≤2,000 words, ≤12 KB. Hard ceiling: 500 lines.**

| Bound | Value | Basis |
|---|---|---|
| Target lines | **≤200** | 48/68 (71%) of measured `SKILL.md` files are ≤200 lines; p75 of the corpus is 225. The two closest analogues are 118 L and 322 L. |
| Target words | **≤2,000** | Corpus word medians: 574 (mattpocock), 948 (vercel), 1,176 (anthropic), 1,354 (obra). 2,000 sits above every median and below the max of all but two files. |
| Target bytes | **≤12 KB** | Largest mattpocock `SKILL.md` is 12,594 B (`ask-matt`); `vercel-optimize` is 17,311 B. 12 KB is the top of the "thin" band. |
| Hard ceiling | **500 lines** | Anthropic's published limit, stated twice in the live guide and once in `skill-creator`: "Keep SKILL.md body under 500 lines for optimal performance. If your content exceeds this, split it into separate files." Only 2/68 corpus files exceed it. |
| Recipe file | **≤300 lines**, TOC above 100 lines | `skill-creator`: "For large reference files (>300 lines), include a table of contents"; the live guide: "For reference files longer than 100 lines, include a table of contents at the top." |

Why all three units and not just lines: bytes-per-line varies 36.7 (vercel) to 62.8 (mattpocock) across
the corpus, so a line count alone is not a token budget. Anthropic's own `skill-creator` is 485 lines —
under the 500-line ceiling — but 33,168 B / 5,205 words, the largest in the corpus. Budgeting lines
*and* words *and* bytes closes that gap.

The 200-line target is a **trigger for the split, not a target to fill**: if the body is approaching 200
lines, the content that pushed it there is almost certainly a recipe detail that belongs in
`recipes/<id>.md`. `skill-creator` states the same move: "if you're approaching this limit, add an
additional layer of hierarchy along with clear pointers about where the model using the skill should go
next to follow up."

### 7.3 Recipe applicability — machine-checkable, following `vercel-optimize`

Put the applicability conditions in recipe frontmatter and have `scripts/detect.mjs` evaluate them, rather
than asking the agent to judge in prose. This is the one place the corpus has a strong precedent, and it
is the same shape as the already-decided "dependency-free `scripts/detect.mjs` detector":

```md
---
id: bun-test-gate
title: Bun test gate
requires: ["bun"]            # observable facts detect.mjs emits
excludes: []
priority: 50
files: ["files/bun-test-gate/"]
---
```

`detect.mjs` emits the facts (package manager, test runner, linter present, monorepo signals, TS config
presence, CI provider); the skill filters recipes on `requires`/`excludes`; the plan prints the selected
set with the fact that selected each one. Precedents:

- `vercel-optimize/references/support-topics/*.md` frontmatter (`candidateKinds`, `frameworks`,
  `priority`, `metrics`, `routePatterns`, `maxBriefChars`) evaluated by `lib/support-topics.mjs`, with a
  cap on how many can be selected.
- `vercel-optimize/lib/framework-support.mjs` — a pure classifier returning
  `{ok, status, blocker}` that the body then branches on.
- `writing-skills`: "if it's enforceable with regex/validation, automate it—save documentation for
  judgment calls."
- `writing-for-agents`: "Conditional keyed to an observable predicate."
- Anthropic's guide's **plan-validate-execute** pattern, recommended for "batch operations, destructive
  changes, complex validation rules, high-stakes operations" — which is what wiring gates into a repo is.

Two constraints from the precedent: keep the detector **dependency-free** (`.mjs`, `node:` builtins only,
no `package.json` in the skill directory — the `vercel-optimize` model), and **cap the selection** so a
broad match cannot flood the context (`SUPPORT_TOPIC_LIMIT = 3` / `SUPPORT_TOPIC_TOTAL_CHAR_LIMIT = 2400`
is the precedent; a plan that selects 12 recipes should print the list and the reasons, not inline all 12
bodies).

### 7.4 Routing in the body

Use a **routing table with the condition in the first column**, one row per recipe, plus the mattpocock
branch-first gloss. Concretely, `SKILL.md` carries a table like:

| Detected fact | Recipe | File |
|---|---|---|
| `packageManager: bun` | Bun test gate | `recipes/bun-test-gate.md` |
| `packageManager: npm` | npm test gate (gated variant) | `recipes/npm-test-gate.md` |
| `monorepo: true` | Per-package gates | `recipes/monorepo-gates.md` |

and each recipe file is linked directly from `SKILL.md` (one level deep). The body then says, in the
mattpocock style: `- **<condition>**, see [recipes/<id>.md](recipes/<id>.md): <what it wires and what it
writes>.`

Two rules the corpus states and we should follow:

- **One trigger per branch.** `writing-for-agents`: "Synonyms that rename a single branch are one branch
  written twice; collapse them and keep only genuinely distinct branches." Do not list both "uses Bun" and
  "has bun.lockb" as separate rows.
- **Scripts are executed, not read.** Anthropic's guide and `webapp-testing` both say to invoke bundled
  scripts as black boxes and not ingest their source. `SKILL.md` should say `node scripts/detect.mjs` and
  describe the JSON it prints, not paste the detector.

### 7.5 What not to copy

- **The generated `AGENTS.md` compiled document** (22–108 KB in vercel). It exists because vercel
  generates `SKILL.md`'s tables from `rules/` via a build package. We have no build step and no need for
  a second, always-stale copy of the recipes.
- **Anthropic's `requirements.txt` dependency model.** Our detector must run with no install step; the
  `vercel-optimize` builtins-only model is the right one.
- **`@`-style force-loading links.** `writing-skills`: "`@` syntax force-loads files immediately,
  consuming 200k+ context before you need them."
- **A `recipes/README.md` as the agent's only index.** It would make references two levels deep, which
  Anthropic's guide names as a failure mode ("an agent might use commands like `head -100` to preview
  content rather than reading entire files, resulting in incomplete information").

---

## 8. Sources

Primary, all read 2026-10-08.

**Anthropic authoring guidance**
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices — 500-line body limit, one-level-deep references, TOC above 100 lines, three progressive-disclosure patterns, utility-script guidance, plan-validate-execute, package dependencies, runtime environment.
- https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md — three-level loading model, "SKILL.md (workflow + selection)" domain layout, >300-line TOC rule, description-as-trigger guidance.
- https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md — black-box script invocation.
- https://github.com/anthropics/skills/blob/main/skills/internal-comms/SKILL.md — type→file routing.
- https://github.com/anthropics/skills/blob/main/skills/mcp-builder/SKILL.md — phase-tagged load list.
- https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md — inline-at-point-of-use routing.
- https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md — the no-split counter-case.
- https://github.com/anthropics/skills/blob/main/template/SKILL.md — bare scaffold.

**vercel-labs/agent-skills**
- https://github.com/vercel-labs/agent-skills/blob/main/README.md — § Skill Structure.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md — thin body + `rules/` + priority table + quick-reference index.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/_template.md and `_sections.md` — rule frontmatter contract.
- https://github.com/vercel-labs/agent-skills/blob/main/packages/react-best-practices-build/src/validate.ts — machine-checked rule content.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/react-view-transitions/SKILL.md and `README.md` — `references/` split, documented structure diagram.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/vercel-optimize/SKILL.md — pipeline-with-pointers body.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/vercel-optimize/references/support-topics/README.md — the frontmatter applicability contract.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/vercel-optimize/references/support-topics/cdn-cache-auth-safety.md — a real topic file.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/vercel-optimize/lib/support-topics.mjs — the selector and its caps.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/vercel-optimize/lib/framework-support.mjs — pure applicability classifier.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/vercel-optimize/references/playbooks/README.md — signal→profile detection table.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/vercel-optimize/scripts/verify-finding.mjs and `lib/util.mjs` — dependency-free script shape.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/deploy-to-vercel/resources/deploy.sh — bash script shape.
- https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md — 39-line fetch-at-runtime skill.

**obra/superpowers**
- https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md — separate-files rule (100+ lines), keep-inline rule (<50 lines), interpreter-invocation rule, no-`@`-links rule, Match the Form to the Failure table, token targets.
- https://github.com/obra/superpowers/blob/main/skills/writing-skills/anthropic-best-practices.md — vendored copy of the Anthropic guide (1,150 L).
- https://github.com/obra/superpowers/blob/main/skills/using-superpowers/SKILL.md — platform table → reference file.
- https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md — inline pointers + supporting-techniques list.
- https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md — 568-line body with prompt-template pointers.
- https://github.com/obra/superpowers/blob/main/skills/executing-plans/scripts/task-start and `subagent-driven-development/scripts/sdd-workspace` — bash script shape.

**mattpocock/skills** (vendored at `.agents/skills/` in this repo)
- `.agents/skills/writing-for-agents/SKILL.md` — information hierarchy, branching disclosure test, sprawl, pointer wording, two loads.
- `.agents/skills/writing-for-agents/SKILL-MECHANICS.md` — model- vs user-invocation, router skills.
- `.agents/skills/setup-matt-pocock-skills/SKILL.md` — the closest structural analogue; seed-template pointer list.
- `.agents/skills/codebase-design/SKILL.md`, `prototype/SKILL.md`, `tdd/SKILL.md`, `domain-modeling/SKILL.md`, `triage/SKILL.md`, `teach/SKILL.md` — branch-first pointer style.
- `.agents/skills/wizard/SKILL.md` — ship-a-template pattern.

**skills CLI**
- https://github.com/vercel-labs/skills/blob/main/README.md — discovery containers and depth 3, required/optional frontmatter, install methods, direct-URL download caps (10 MiB / 25 MiB / 1000 files).
- https://github.com/vercel-labs/skills/blob/main/src/installer.ts — `copyDirectory` recurses and copies the whole skill directory.

**Not verified / out of scope**
- Whether the `skills` CLI imposes any per-`SKILL.md` size limit: **UNVERIFIED** — no such limit appears in the README or `installer.ts`; the only caps found are the direct-URL download/extract limits above.
- `obra/superpowers` `skills/diagnosing-superpowers/SKILL.md` (6,904 B) was not read; its sibling layout (`prompts/` 11, `references/` 4, `templates/` 4) is recorded from the tree only.
