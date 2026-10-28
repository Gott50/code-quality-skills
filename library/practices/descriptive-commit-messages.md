---
id: descriptive-commit-messages
title: Write the commit message for the reader who arrives via git blame
when: { requires: [{ file: package.json }] }
source: research/tiger-style.md
enforcedBy: [release-automation, release-automation-npm]
---

Write the commit message for the reader who will arrive at this line months from now through `git blame`, not for the reviewer who has the pull request open beside it.

The message is the only record of the change that stays in the repository. A pull-request description is not stored in the history and is invisible in `git blame`, so the reasoning that lived there is gone the moment the branch is merged and the tab is closed. The body is where the why survives: the problem that prompted the change, the constraint that ruled out the obvious fix, the alternative that was tried and rejected, and the consequence a reader cannot recover from the diff alone.

The diff is not a substitute for the message. It shows what changed but not why, and a message that only restates it — "rename the field", "add a null check" — forces every future reader to re-derive the reasoning from the code, which is exactly the work the author had already done and could have written down in a sentence. State the intent the diff cannot express, and leave the mechanical summary to the diff itself.

The reader who matters most is the one who never saw the change: they arrive at a line through `git blame`, follow it to the commit, and have only the message to tell them whether the code is deliberate or accidental, load-bearing or vestigial. Write for that reader, and write the body at the moment the change is fresh, because the reasoning decays faster than the code. The header shape is the half a check can enforce; whether the body informs is judgement no check can decide, and that judgement is the practice.
