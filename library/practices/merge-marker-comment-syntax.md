---
id: merge-marker-comment-syntax
title: A marker comment must be valid in its target language
when: { requires: [{ recipe: agent-guidance }] }
source: research/agent-conventions.md
enforcedBy: []
---

Write a marker block's comment in the syntax of the file it lands in.

A marker pair — `code-quality:<id>:start` and `code-quality:<id>:end` — is taken verbatim from the
template, and the comment syntax around it is the template's choice. It must be a valid comment in
the target language: `<!-- … -->` for Markdown and HTML, `#` for shell, YAML, TOML and gitignore,
`//` for JavaScript and TypeScript. The wrong choice is not cosmetic. A `.husky/pre-commit` body is
executed by `sh`, where `<!--` is a redirection, so a Markdown-style marker there is a syntax error
at every commit.

The shell case is checked: the library's own validation renders each template whose target is a
husky hook and runs `sh -n` over it. The general case is judgement, because the detector reads
frontmatter and never parses the target language — a marker in a language nobody has taught it yet
is caught by reading the file, not by a gate.

When you add a merge target, pick the comment syntax from the target path, not from the template's
own extension: the template is a library file, and the consumer's file is what runs.
