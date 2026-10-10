# `feedback.mjs` — the opt-in feedback channel

`node scripts/feedback.mjs [projectDir] --error <text> [options]` builds the redacted report for an
unexpected failure (or the user's say-so), prints it, and prints the filing path. Zero
dependencies, node builtins only, no package manager invoked, **sends nothing**: the agent shows
the report, and the human files it. Exit 0 on a report (and when the channel is off); exit 1 with a
message on stderr on a bad invocation.

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
| `--stack <json>` | the detector's stack report (the `detect.mjs` output, or just its `stack`); default: run `detect.mjs` |
| `--skill-version <v>` | the skill version; default: the manifest's `skill.version`, else the constant |
| `--gh` / `--no-gh` | force `gh` availability; default: probe `gh --version` |
| `--json` | print the machine-readable `{ payload, filing }` instead of the report |
| `--help` | print the usage and exit 0 |

`--error` (or `--error-file`) is required once the channel is on. `--recipe` and the plan excerpt
are optional: a user-initiated report may name neither.

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
    "error": "ENOENT: no such file or directory, open '<project>/references/recipes/x.md'",
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

## Redaction

Three classes, applied to every string in the payload:

| Class | Rule |
|---|---|
| **absolute paths** | the project root (its resolved path, its realpath, and the shell's logical `PWD` when it names the same directory) becomes `<project>`, so the report keeps the relative shape; every other absolute path (POSIX `/a/b`, Windows `C:\a\b`) becomes `<path>` |
| **package names** | the project's own package names — `packages[].name` — become `<package>` everywhere they appear |
| **source** | the plan renders a file's unified diff as 4-space-indented lines; each run of them collapses to `    <source omitted>` |

Dependency names are **kept**: they are public, and they are the stack report's evidence — a report
that redacted `vitest` and `stryker` could not be reproduced. The sensitive identity is the
project's own package name, which is redacted.

The redaction is deliberately over-eager: a path-like token in prose is redacted even when it is
not a real path. Over-redaction is safe; under-redaction is not.

## Filing

The destination is fixed: a new issue on **`Gott50/code-quality-skills`**, labelled **`feedback`**
and **`needs-triage`**. The title is `[feedback] <recipe>: <first line of the error>` (or
`[feedback] <first line>` when no recipe is named), truncated to 80 characters.

Three paths, in order:

1. **The prefilled URL** — `https://github.com/Gott50/code-quality-skills/issues/new?title=…&body=…&labels=feedback,needs-triage`.
   It works with no auth. GitHub caps the request line at 8 KB and answers an over-long URL with
   414, so the URL is used only when it fits (`MAX_URL_LENGTH = 8000`).
2. **`gh issue create`** — the richer path, with no URL limit. Used when the URL is too long, and
   offered alongside the URL when `gh` is available. The full report is written to
   `<tmpdir>/code-quality-feedback.md` and passed with `--body-file`:
   `gh issue create --repo Gott50/code-quality-skills --label feedback --label needs-triage --title '…' --body-file '…'`.
3. **Truncate and attach** — when the URL is too long **and** `gh` is unavailable: the body is
   truncated to the largest prefix whose URL fits (plus a marker), the truncated URL is printed,
   and the full report is written to `<tmpdir>/code-quality-feedback.md` for the user to attach.

The report file is a local artifact, never a send. `feedback.mjs` writes it only on paths 2 and 3.

## Exit codes

| Code | When |
|---|---|
| 0 | a report was printed; the channel is off; `--help` |
| 1 | a bad invocation (unknown option, no `--error`, an unreadable `--error-file`, a `--stack` that is not JSON) |

## What it does not do

- No network, no `gh` invocation beyond the `gh --version` availability probe, no issue created.
- No gate is run; the stack report comes from `detect.mjs` (or `--stack`).
- No history: the report is built from the failure context it is given.
