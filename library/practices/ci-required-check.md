---
id: ci-required-check
title: Make the CI check a required status check
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/formatting.md
enforcedBy: [ci-workflow, ci-workflow-npm]
---

Make the CI check a required status check on the protected branch; a workflow that runs is not a gate until the branch refuses to merge without it.

Every client-side hook is bypassable by design — `git commit --no-verify` skips it, and a hook that is not installed skips itself — so the only non-bypassable enforcement point is CI plus branch protection. GitHub requires that a required status check have a `successful`, `skipped`, or `neutral` status before collaborators can change a protected branch. Until the check is required, a red run is a notification, not a gate: the merge button stays green.

The library writes the workflow, and that is as far as a file can go. Branch protection is a repository setting, not a file in the tree, so the last step is manual: mark the workflow's job as required on the protected branch. Do it once, and the check the workflow already runs becomes the enforcement the hooks only approximate.

The check that is required must be the one that runs the gates. A required check that is skipped on the paths that matter, or that runs a subset of the gates, enforces the subset. A required check that is flaky is worse than none: it trains everyone to re-run until it passes, which is the same as not having it.

**Every workflow file the library writes must be named.** A workflow file that is not a required status check is a gate the repo can bypass, so the list is the enforcement surface, not a suggestion:

- `.github/workflows/ci.yml` — the fast gates (`ci-workflow` / `ci-workflow-npm`).
- `.github/workflows/code-quality-drift.yml` — the drift report (`ci-drift`). Deliberately **not** required: the job never fails a PR, so requiring it would enforce nothing.
- `.github/workflows/secret-scan.yml` — the credential scan (`secret-scan`).
- `.github/workflows/dep-audit.yml` — the advisory ratchet (`dep-audit`).
- `.github/workflows/semgrep.yml` — the pattern-level security scan (`semgrep`).
- `.github/workflows/license-check.yml` — the license allowlist and SBOM (`license-check`).
- `.github/workflows/release.yml` — the release derivation (`release-automation` / `release-automation-npm`). Deliberately **not** required: it triggers on `push` to `main` and `workflow_dispatch` only, never on a PR, so it cannot be a required PR check.

A new workflow file that this list does not name is a gate nobody enforces. When a recipe adds one, add it here in the same change.
