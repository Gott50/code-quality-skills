# The applied-state manifest is committed, so CI can read it

Supersedes [ADR 0001](0001-filesystem-is-the-source-of-truth.md). The precedence rule is unchanged: the filesystem is still the source of truth and `.code-quality.json` is still an index of what the skill wrote, never a claim about what is true. What changes is where the index lives — it is committed, not gitignored, so a CI job can read it and compare the whole filesystem against it.

ADR 0001 gitignored the manifest because it was written unsorted and the formatter recipes' repo-wide `format:check` failed on it (ticket #34). That made the manifest a local-only artifact: a fresh clone had no index, and CI had nothing to compare against. The `ci-drift` job needs the committed manifest — the committed skill pins the library, and the committed manifest pins what that library wrote — so the manifest has to be a normal tracked file.

The objection #34 raised against sorting it was that key order alone is not enough: Biome's `useSortedKeys` also checks indentation and the trailing newline, and byte-exact agent output is fragile. The answer is not prose but a mechanism: `scripts/manifest.mjs` is the canonical writer, and the agent records each recipe through it instead of hand-writing JSON. It emits the one form Biome's formatter leaves alone — keys sorted, two spaces of indent, a trailing newline — so `biome check .` is a no-op on the manifest, and re-recording an unchanged recipe rewrites the same bytes.

## Consequences

- The manifest is a committed generated file, and the consumer must keep it in sync: a hand-edit is drift the drift report will surface, and a stale manifest is a stale index. It is still never the source of truth — deleting it degrades the report to "compare against the current library only" and nothing else (ADR 0001).
- The formatter recipes' `.gitignore` blocks no longer name `.code-quality.json`. A repo that does not want the manifest committed adds its own ignore line; the skill does not decide that for it.
- The manifest must be written only through `scripts/manifest.mjs` (or an equally deterministic serialization). Hand-written JSON is not byte-stable, and the formatter gate the recipes install will fail on it.
- The schema is unchanged (`schemaVersion` 1, `recipes[]`, `declined[]`; PLAN-SCHEMA.md → the manifest hash convention). This ADR is about where the file lives and how it is serialized, not about its shape.
