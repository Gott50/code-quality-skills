---
id: comments
title: Say why, not what
when: { requires: [{ file: package.json }] }
source: research/best-practices-coverage.md
enforcedBy: [oxlint-anti-slop, oxlint-anti-slop-npm]
---

Comment the reason a decision was made, the constraint the code relies on, or the side effect a
reader would not expect — never the thing the next line already says.

The code shows what happens; a comment earns its place by showing what the code cannot: why this
approach and not the obvious one, which invariant a caller must preserve, which external system's
quirk is being worked around. `// increment i` above `i++` is noise that has to be maintained and
can be wrong; `// the upstream sends epoch seconds, not millis` is the sentence that saves the next
reader an afternoon.

Keep a comment next to the code it describes, because a comment drifts toward false as the distance
grows, and update it in the same change that moves the code. A comment that lies is worse than no
comment, and a `TODO` with no owner or date is a note that will outlive its relevance. Commented-out
code belongs in version control's history, not in the file.

When a comment is needed because the code is confusing, treat that as the code's report about
itself: a well-named function or a reshaped interface often removes the need for the comment
entirely. Where a suppression must stand — a lint directive, a type assertion — the comment states
the reason, which is also what the lint layer requires of the directives the library installs.

A test says how as well as why: open it with a description of the goal it establishes and the
methodology it uses to establish it, so a reader can get up to speed on the section or skip it
without diving into the body. The test's name says what it covers; the opening says how it covers
it — the setup it builds, the path it drives, the property it checks. A reader who knows the method
can trust the result without reading every line, and one who does not can decide in a sentence
whether the section is theirs to read.
