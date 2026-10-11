# The feedback channel

An opt-in way to report an unexpected failure in this skill back to its maintainers — or to
propose a new recipe for the library. It is **off by default** and it **never sends anything on its
own**: the agent builds the redacted report, shows it, and the human files it.

`scripts/feedback.mjs` is the whole mechanism; `scripts/FEEDBACK-SCHEMA.md` is its contract. Two
report types share it: a **failure report** (`--error`) and a **recipe proposal** (`--proposal`).

## When to offer

Offer the channel on an **unexpected failure** — the skill did not do what its own contract says:

- a **detector hard error** — `detect.mjs` exits 1 (the target is not a directory, or
  `library/recipes/` is missing);
- a **malformed recipe** — a `{ id, error }` line in the plan's Warnings, or "no usable recipe
  remains";
- a **`verify` that fails for a reason the plan did not predict** — the plan predicted a `loss` or
  a `duplicate` and the verify failed anyway, or a gate failed on a file the plan called `intact`.

Do **not** offer it for the expected outcomes: a plan the user declined, a `loss` the plan told you
to skip, a `duplicate` block, a gate that fails because the repo's code is not green yet, or a
missing package manager. Those are the skill working as designed.

Also offer it on the **user's say-so** — "this is wrong", "report this", "file a bug" — with the
user's description as the failure text.

## How to run it

The channel is off until the user opts in. Ask once, then enable it:

```
node scripts/manifest.mjs feedback [projectDir] --enable
```

Then build the report. Pass the failure context; the stack report is read from `detect.mjs` unless
you pass `--stack`:

```
node scripts/feedback.mjs [projectDir] --recipe <id> --error-file <path> [--plan-excerpt-file <path>]
```

- `--recipe` — the failing recipe id, when one is named.
- `--error-file` — the failure text. Write the error (or the user's description) to a file; a
  multi-line error is easier to pass this way than with `--error`.
- `--plan-excerpt-file` — the relevant part of the plan: the Warnings line, the failing recipe's
  Gates and verify entry, the file row. Do **not** paste the whole plan; the excerpt is what makes
  the report diagnosable. The script redacts the diff bodies (the user's source) automatically.

The script prints the redacted report and the filing path. It writes nothing to the project and
sends nothing.

## Proposing a recipe

When the user has written a recipe they want to contribute to the library — a new recipe `.md` and
its templates — offer the **proposal** type instead of a failure report. It attaches the recipe,
the templates its `files[].template` names, a rationale, and the redacted stack report, and files
it as a `recipe-proposal` issue.

```
node scripts/feedback.mjs [projectDir] --proposal <recipe-path> --library <libdir> [--rationale <text>]
```

- `--proposal` — the recipe `.md` to propose. Its frontmatter `id` names the recipe; the templates
  it names are read from the library.
- `--library` — the library dir the templates are resolved against (default: `$CODE_QUALITY_LIBRARY`,
  else the repo layout). A template the recipe names but the library lacks is a hard error, so the
  proposal is never filed incomplete.
- `--rationale` (or `--rationale-file`) — why the recipe belongs in the library. Optional; a
  default is used when omitted.

The recipe, its templates and the rationale are attached **verbatim** — the proposal is filed to
the project the recipe is meant to live in, so nothing in it is redacted. Only the **stack report**
is redacted (absolute paths and the project's own package names), exactly as in a failure report.
Show the report first, exactly as for a failure report.

## Show the report first

Print the report to the user **before** anything is filed, and say what was redacted: absolute
paths, the project's own package names, and source. The report is the whole payload — if the user
does not want something in it, they say so and you stop.

## File it

The report's filing section names the destination (`Gott50/code-quality-skills`) and the path. A
failure report is labelled `feedback` and `needs-triage`; a recipe proposal is labelled
`recipe-proposal` and `needs-triage`. The path is one of:

- **the prefilled URL** — the default. The user opens it and submits; it needs no auth.
- **`gh issue create`** — the richer path, printed when `gh` is available or when the URL is too
  long for GitHub's limit. The full report is written to a temp file and passed with `--body-file`.
- **truncate and attach** — when the URL is too long and `gh` is unavailable: the truncated URL is
  printed and the full report is written to a temp file for the user to attach.

Run the `gh` command only if the user asks you to file it; the URL is theirs to click. Never file
without the user's explicit go-ahead.

## Turn it off

```
node scripts/manifest.mjs feedback [projectDir] --disable
```

`--disable` removes the key, so the manifest is byte-identical to one that never opted in.
