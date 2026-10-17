---
id: environment-is-a-source-of-truth
title: Do not cache what the environment already says
when: { requires: [{ recipe: agent-guidance }] }
source: research/agent-conventions.md
enforcedBy: []
---

Do not write down what the environment already says.

The environment is a source of truth too — `package.json` scripts, config files, the directory
layout, `--help` output — and a document that restates it is a cache: a copy of a lookup, earning
its load only when the lookup is expensive. A directory listing is cheap; the one command that
regenerates a generated file is not, and neither is a convention that differs from the tool's
default.

The include/exclude line follows from that. Include commands the agent cannot guess, code style
rules that differ from the defaults, testing instructions, repository etiquette, architectural
decisions, environment quirks, and common gotchas. Exclude anything the agent can figure out by
reading the code, standard language conventions, detailed API documentation (link to it instead),
information that changes frequently, long explanations, file-by-file descriptions, and self-evident
practices.

Without pruning the default fate is sediment: stale layers that settle because adding feels safe
and removing feels risky, until someone has to core down through them to find what is still live.
