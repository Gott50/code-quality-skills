---
id: hook-skippability
title: Treat every client-side hook as skippable
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/ci-hooks.md
enforcedBy: [repo-hygiene, repo-hygiene-npm]
---

Treat every client-side hook as skippable, and make the skip narrow rather than total.

Skippability is not a concession the library makes; it is a property of git. `git commit
--no-verify` bypasses the pre-commit and commit-msg hooks, `git push --no-verify` bypasses
pre-push, and the hook installer adds its own switch that disables every hook on the machine. A
hook is a convenience that catches a mistake early, never the enforcement — the enforcement is the
server side, which is why the CI job is the one that has to be required.

Because the blunt bypass is always available and always total, the useful design goal is a narrow
one: a way to skip a single gate without skipping the rest. A hook that offers no narrow skip
pushes the developer toward the blunt one, and the blunt one takes every gate in the file with it.

The policy question — whether the team accepts that a hook can be skipped at all — is a judgement,
and the answer is usually yes, because the alternative is a hook that lies about what it enforces.
What is not a judgement is where the enforcement lives: if a check must not be bypassable, it
cannot live in a hook.
