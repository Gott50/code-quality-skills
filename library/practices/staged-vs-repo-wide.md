---
id: staged-vs-repo-wide
title: Staged-only locally, repo-wide in the gate
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/formatting.md
enforcedBy: [biome-assist, biome-assist-npm, eslint-prettier]
---

Run the local hook on staged files and the gate repo-wide; a staged-only check is a local optimisation, not a gate.

Staged-only sees only the index, so it cannot catch a file that was never staged — one committed by another author, or one the hook skipped. Biome marks `--staged` "intended for local use" and `--changed` "intended for CI", and the split is the point: the hook is there to keep the author's own commit clean, and the gate is there to cover the repository. A gate that only looked at the changeset would pass a repo whose untouched files are unformatted.

The gate's scope also fixes the sweep's scope. A repo-wide gate needs a repo-wide sweep, because the sweep is what makes the wall reachable: narrowing the sweep to the recipe's own files would leave every pre-existing unformatted file failing the gate the recipe installs.

Staged-only carries a correctness hazard that repo-wide does not. `--staged --write` rewrites the worktree, so re-staging a file that also has unstaged changes would commit a blend of reviewed and unreviewed content. Any hook that rewrites staged files needs the partially-staged guard — refuse the commit when a file shows a non-empty character in both the index and worktree columns — or the re-stage silently widens the commit.
