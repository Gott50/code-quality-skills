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
