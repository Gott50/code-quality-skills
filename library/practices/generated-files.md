---
id: generated-files
title: Exclude generated files from the formatter's file set
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/formatting.md
enforcedBy: [biome-assist, biome-assist-npm]
---

Exclude a generated file from the formatter's file set, or the gate fails forever on a file the tool rewrites.

A formatter gate is only as good as its ignore set. A generated file that the gate checks but the generator rewrites unformatted is permanent drift: the gate fails on every run, and no amount of formatting fixes it, because the next generator run undoes the formatting. The file is not the author's to format, so the only fix is to take it out of the checked set.

The judgement is which files count as generated. A file a tool writes — a lockfile, a codegen output, a schema-derived type, a vendored bundle — is generated; a file a human edits is not, however machine-like it looks. The test is who owns the bytes, not how they are shaped. A file that is merely ugly, or that the formatter would churn, is not generated and belongs in the gate.

The exclusion must be reachable by the gate. For Biome, `vcs.useIgnoreFile` plus a `.gitignore` line, or a `files.includes` negation — and a `!!` force-ignore only when the path must never be indexed, because a regular exclusion is preferred for generated source that provides types or other project information. For Prettier, a `.prettierignore` (gitignore syntax) or `.gitignore`, which Prettier reads by default. Put the exemption where the repo can reach it: a `create` target the repo has customized is never overwritten, so an `overrides` entry in the template's own config cannot reach a customized repo, while a merged `.gitignore` block can.
