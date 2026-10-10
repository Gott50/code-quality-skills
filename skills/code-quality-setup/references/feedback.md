# The feedback channel

An opt-in way to report an unexpected failure in this skill back to its maintainers. It is **off
by default** and it **never sends anything on its own**: the agent builds the redacted report,
shows it, and the human files it.

`scripts/feedback.mjs` is the whole mechanism; `scripts/FEEDBACK-SCHEMA.md` is its contract.

## When to offer

Offer the channel on an **unexpected failure** — the skill did not do what its own contract says:

- a **detector hard error** — `detect.mjs` exits 1 (the target is not a directory, or
  `references/recipes/` is missing);
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

## Show the report first

Print the report to the user **before** anything is filed, and say what was redacted: absolute
paths, the project's own package names, and source. The report is the whole payload — if the user
does not want something in it, they say so and you stop.

## File it

The report's filing section names the destination (`Gott50/code-quality-skills`, labels `feedback`
and `needs-triage`) and the path:

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
