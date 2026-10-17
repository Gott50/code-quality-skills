---
id: one-time-sweep
title: Sweep the whole repo once, at the gate's scope
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/formatting.md
enforcedBy: [biome-assist, biome-assist-npm]
---

Sweep the whole repo once when you turn the formatter on, at the gate's scope; narrowing the gate to new files is the alternative, not the default.

Turning a formatter on makes every previously unformatted file a failure, including files the recipe never wrote, so the gate cannot pass until the repo is swept once. The sweep is a one-time command, not a gate: it runs during apply, it is shown in the plan because it touches files the recipe did not author, and it is not reversible — the formatted files stay formatted. It is idempotent by construction, so a second run finds nothing to fix.

The sweep's scope must equal the gate's scope. A repo-wide gate needs a repo-wide sweep, even though the sweep then reformats files the recipe does not own. Narrowing the sweep to the recipe's own files would leave every pre-existing unformatted file failing the gate the recipe installs, so the recipe's own verify could never pass. A repo that does not want a particular generated file reformatted excludes it in its own config; the recipe does not own that file.

The alternative is to narrow the gate to new files instead of sweeping. That trades a one-time diff for a permanent exemption list, and it is a legitimate choice for a repo that cannot absorb the diff in one commit. The sweep is the default because it leaves no file permanently outside the gate, and because the exemption list is the thing that rots.
