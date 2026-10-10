# The filesystem is the source of truth; the applied-state manifest is an optimization

**Superseded by [ADR 0002](0002-manifest-is-committed.md)** — the precedence rule below still holds, but the manifest is no longer gitignored: it is committed so CI can read it.

A recipe's idempotency rests on the files it wrote, not on the committed `.code-quality.json`. The manifest records which files a recipe owns so a re-run knows what to compare; it never decides what is true, and no recipe may depend on it. A user who deletes the manifest loses the ownership index and nothing else — re-running re-derives it.

The obvious alternative, manifest-as-truth (treat what the manifest records as applied), breaks the moment a file is hand-edited or deleted: the manifest would claim an output that is not there, or claim ownership of bytes it no longer matches. Drift — an owned file that no longer matches what its recipe would write — is therefore *reported and diffed*, never silently overwritten, and a missing output is *reinstated* on approval rather than trusted.

## Consequences

- Every recipe must be idempotent on its own terms (a `create` is a no-op on an identical file, a `merge` replaces its own marked block); the manifest cannot rescue a recipe that is not.
- Deleting or gitignoring `.code-quality.json` degrades the drift report to "compare against the current library only", not to a broken skill.
- The skills CLI's own `update` (which replaces the installed skill directory and clobbers hand-edits upstream moved) is never consulted for drift: the report reads the project's filesystem against the manifest and the current library.
