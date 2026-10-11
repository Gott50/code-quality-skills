# `feedback.mjs` — the opt-in feedback channel

`node scripts/feedback.mjs [projectDir] --error <text> [options]` builds the redacted report for an
unexpected failure (or the user's say-so), prints it, and prints the filing path. Zero
dependencies, node builtins only, no package manager invoked, **sends nothing**: the agent shows
the report, and the human files it. Exit 0 on a report (and when the channel is off); exit 1 with a
message on stderr on a bad invocation.

Two report types share the channel:

- a **failure report** (`--error`, the default) — an unexpected failure in the skill;
- a **recipe proposal** (`--proposal`, #119) — a new recipe the user wants to contribute to the
  library, with its templates and a rationale.

The channel is off unless `.code-quality.json` carries `feedback: true`. The flag is written by
`scripts/manifest.mjs` (the canonical writer for that file); the agent-facing flow is
[`references/feedback.md`](../references/feedback.md).

## Options

| Option | Effect |
|---|---|
| `[projectDir]` | the project the failure happened in (default `.`); the manifest is read from here |
| `--recipe <id>` | the failing recipe id |
| `--error <text>` | the failure text — the error, or the user's description of the problem |
| `--error-file <path>` | read the failure text from a file (a multi-line error is easier this way) |
| `--plan-excerpt <text>` | the plan excerpt |
| `--plan-excerpt-file <path>` | read the plan excerpt from a file |
| `--proposal <recipe-path>` | propose a new recipe: the recipe `.md`, its templates, a rationale |
| `--rationale <text>` | the proposal's rationale (or `--rationale-file <path>`) |
| `--rationale-file <path>` | read the rationale from a file |
| `--stack <json>` | the detector's stack report (the `detect.mjs` output, or just its `stack`); default: run `detect.mjs` |
| `--library <path>` | the library dir for the detector and the proposal's templates; default: `$CODE_QUALITY_LIBRARY`, else the repo layout |
| `--skill-version <v>` | the skill version; default: the manifest's `skill.version`, else the constant |
| `--gh` / `--no-gh` | force `gh` availability; default: probe `gh --version` |
| `--json` | print the machine-readable `{ payload, filing }` instead of the report |
| `--help` | print the usage and exit 0 |

Exactly one report type is required once the channel is on: `--error` (or `--error-file`) for a
failure report, or `--proposal` for a recipe proposal — not both. `--recipe` and the plan excerpt
are optional: a user-initiated report may name neither. `--rationale` is optional for a proposal
(a default is used).

## The opt-in flag

The flag is a **top-level boolean** in `.code-quality.json`, **off by default**:

```json
{
  "appliedAt": "2026-10-10T17:06:31.060Z",
  "declined": [],
  "feedback": true,
  "recipes": [],
  "schemaVersion": 1
}
```

| Value | Meaning |
|---|---|
| `true` | the channel is on: `feedback.mjs` builds and prints the report |
| absent, or `false` | the channel is off: `feedback.mjs` prints a note to stderr and exits 0 |

`--enable` writes `feedback: true`; `--disable` **removes the key**, so "off" is the absence of the
field and a disabled manifest is byte-identical to one that never opted in. Both are idempotent,
and the writer keeps the file in the canonical form (keys sorted, two spaces, a trailing newline)
that the formatter recipes' `biome check .` leaves alone — the same guarantee `record` and
`decline` give.

```
node scripts/manifest.mjs feedback [projectDir] --enable
node scripts/manifest.mjs feedback [projectDir] --disable
```

A boolean, not an object: the destination and the labels are fixed (below), so there is nothing
else to configure, and the absence of the key is the whole "off" state.

## The payload

`--json` prints `{ payload, filing }`. The `payload` is the redacted report:

```jsonc
{
  "schemaVersion": 1,
  "skill": { "name": "code-quality-setup", "version": "1" },
  "stack": { "languages": {}, "packageManager": {}, "workspace": {} },
  "packages": [ { "role": "root", "path": ".", "name": "<package>", "dependencies": ["vitest"] } ],
  "stackError": null,
  "failure": {
    "recipe": "biome-assist",
    "error": "ENOENT: no such file or directory, open '<project>/library/recipes/x.md'",
    "planExcerpt": "## Warnings\n\n- `{ id: \"biome-assist\", error: \"…\" }`"
  },
  "redactions": ["absolute paths", "package names", "source"],
  "generatedAt": "2026-10-10T17:07:07.270Z"
}
```

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `skill` | the skill's name and version — the version is the manifest's `skill.version` when present, else the constant |
| `stack` | the detector's `stack` report (`DETECT-SCHEMA.md` → `stack`), redacted; `null` when the detector could not run (a detector hard error is one of the triggers) |
| `packages` | the detector's `packages[]`, redacted; `null` when the detector could not run |
| `stackError` | why the detector could not run (its stderr, redacted), or `null` when it did |
| `failure.recipe` | the failing recipe id, or `null` |
| `failure.error` | the failure text, redacted |
| `failure.planExcerpt` | the plan excerpt, redacted |
| `redactions` | the redaction classes applied, for transparency |
| `generatedAt` | the ISO timestamp the report was built |

The text report is the same payload rendered as Markdown — it is both what the agent prints and
the issue body.

## The proposal payload

With `--proposal`, `--json` prints the same `{ payload, filing }` shape, but the `payload` is a
recipe proposal: it carries `type: "proposal"` and a `proposal` object in place of `failure`.

```jsonc
{
  "schemaVersion": 1,
  "type": "proposal",
  "skill": { "name": "code-quality-setup", "version": "1" },
  "proposal": {
    "recipe": {
      "id": "biome-assist",
      "path": "library/recipes/biome-assist.md",
      "content": "---\nid: biome-assist\n…"
    },
    "templates": [
      { "path": "templates/biome-assist/biome.json", "content": "{ … }" }
    ],
    "rationale": "Adds a Biome formatter recipe for Bun repos."
  },
  "stack": { "languages": {}, "packageManager": {}, "workspace": {} },
  "packages": [ { "role": "root", "path": ".", "name": "<package>", "dependencies": ["vitest"] } ],
  "stackError": null,
  "redactions": ["absolute paths", "package names"],
  "generatedAt": "2026-10-11T19:15:29.552Z"
}
```

| Field | Meaning |
|---|---|
| `type` | `"proposal"` — the failure payload has no `type` (it is the default shape) |
| `proposal.recipe.id` | the recipe's frontmatter `id` (else the filename stem) |
| `proposal.recipe.path` | the `--proposal` path as given, **verbatim** |
| `proposal.recipe.content` | the recipe `.md` **verbatim** |
| `proposal.templates[]` | one entry per distinct `files[].template` the recipe names, resolved against the library: `{ path, content }`, **verbatim** |
| `proposal.rationale` | `--rationale` (or `--rationale-file`), else a default, **verbatim** |
| `stack`, `packages`, `stackError` | the detector's report, **redacted** — the same fields and redaction as the failure payload |
| `redactions` | `["absolute paths", "package names"]` — applied to the stack report only (see below) |
| `generatedAt` | the ISO timestamp the report was built |

The recipe, its templates and the rationale are attached **verbatim**: the proposal is filed to the
project the recipe is meant to live in, and the redaction is over-eager — it rewrites a URL to
`https:<path>` and Biome's `"//"` microsyntax to `<path>` — which would make the proposed recipe
useless upstream. Only the **stack report** (the machine-specific part) is redacted, exactly as in
a failure report. The `redactions` field names the classes applied to that report.

A `--proposal` whose recipe file is missing, or whose recipe names a `files[].template` the library
does not contain, is a hard error (exit 1): the proposal is incomplete without them, and a silent
omission would file a broken proposal.

## Redaction

Three classes, applied to every string in the payload:

| Class | Rule |
|---|---|
| **absolute paths** | the project root (its resolved path, its realpath, and the shell's logical `PWD` when it names the same directory) becomes `<project>`, so the report keeps the relative shape; every other absolute path (POSIX `/a/b`, Windows `C:\a\b`) becomes `<path>` |
| **package names** | the project's own package names — `packages[].name` — become `<package>` everywhere they appear |
| **source** | the plan renders a file's unified diff as 4-space-indented lines; each run of them collapses to `    <source omitted>` |

A failure report applies all three to the whole payload. A proposal applies the first two to the
**stack report only**: the recipe, its templates and the rationale are attached verbatim, because
the redaction is over-eager and would mangle the recipe the proposal exists to contribute (see
[The proposal payload](#the-proposal-payload)).

Dependency names are **kept**: they are public, and they are the stack report's evidence — a report
that redacted `vitest` and `stryker` could not be reproduced. The sensitive identity is the
project's own package name, which is redacted.

The redaction is deliberately over-eager: a path-like token in prose is redacted even when it is
not a real path. Over-redaction is safe; under-redaction is not.

## Filing

The destination is fixed: a new issue on **`Gott50/code-quality-skills`**. A failure report is
labelled **`feedback`** and **`needs-triage`**; a recipe proposal is labelled **`recipe-proposal`**
and **`needs-triage`**. The title is `[feedback] <recipe>: <first line of the error>` (or
`[feedback] <first line>` when no recipe is named) for a failure, and
`[recipe-proposal] <recipe-id>: <first line of the rationale>` for a proposal, truncated to 80
characters.

Three paths, in order:

1. **The prefilled URL** — `https://github.com/Gott50/code-quality-skills/issues/new?title=…&body=…&labels=…`.
   It works with no auth. GitHub caps the request line at 8 KB and answers an over-long URL with
   414, so the URL is used only when it fits (`MAX_URL_LENGTH = 8000`).
2. **`gh issue create`** — the richer path, with no URL limit. Used when the URL is too long, and
   offered alongside the URL when `gh` is available. The full report is written to
   `<tmpdir>/code-quality-feedback.md` (a proposal: `<tmpdir>/code-quality-recipe-proposal.md`) and
   passed with `--body-file`:
   `gh issue create --repo Gott50/code-quality-skills --label feedback --label needs-triage --title '…' --body-file '…'`.
3. **Truncate and attach** — when the URL is too long **and** `gh` is unavailable: the body is
   truncated to the largest prefix whose URL fits (plus a marker), the truncated URL is printed,
   and the full report is written to the temp file above for the user to attach.

The report file is a local artifact, never a send. `feedback.mjs` writes it only on paths 2 and 3.

## Exit codes

| Code | When |
|---|---|
| 0 | a report was printed; the channel is off; `--help` |
| 1 | a bad invocation (unknown option, neither `--error` nor `--proposal`, both, an unreadable `--error-file`/`--rationale-file`, a `--stack` that is not JSON, a `--proposal` recipe that is missing or names a template the library lacks) |

## What it does not do

- No network, no `gh` invocation beyond the `gh --version` availability probe, no issue created.
- No gate is run; the stack report comes from `detect.mjs` (or `--stack`).
- No history: the report is built from the failure context it is given.
