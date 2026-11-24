---
topic: generated-code-cleanup
question: >-
  Which parts of a generated-looking diff can a gate fail on, and which are
  review judgement — comments that restate the code, JSDoc that repeats the
  name, defensive checks the types rule out, one-caller helpers, unused
  options, hedges, commented-out code, unexplained assertions, meaningless
  names, section banners, and task narration?
verdict: >-
  Two slices are machine-checkable and both are narrow: a comment's length and
  an example's comments (the `comment-length` gate), and an assertion's missing
  reason (the anti-slop rule). Everything else — whether a comment says what the
  next line says, whether a helper earns its name, whether a branch is
  reachable, whether a sentence sells — is judgement, because the check needs
  the intent behind the line and no linter has it. The practice carries that
  half as prose; the gate carries the slice it can see.
sources:
  - https://github.com/vercel-labs/ui/blob/main/.agents/skills/ui-sdk-unslop/SKILL.md
  - https://github.com/vercel-labs/ui/blob/main/scripts/check-comments.mjs
---

# Generated-code cleanup

## The residue generated code leaves

The skill's scope is the diff — `git diff` against the base, or the files it is given — and its
first constraint is that behavior never changes: this is a cleanup pass, not a refactor
([ui-sdk-unslop](https://github.com/vercel-labs/ui/blob/main/.agents/skills/ui-sdk-unslop/SKILL.md)).
What it removes is a list of patterns that read as correct and cost a reviewer time:

- **A comment that says what the next line does.** Delete it. If the line isn't clear without it,
  rename something.
- **A comment on every declaration.** Most constants, fields and functions need none.
- **A comment that explains the design.** The code says that. Keep the one fact it can't show.
- **A comment longer than three lines.** Cut it to the reason; an explanation that needs more goes in
  the docs page, a test title or `contributing/`.
- **A comment that narrates history or the task.** "Now we", "Updated to", "Fixed the bug where",
  "As requested". Delete it; git holds the history.
- **A section banner.** `// ---- Helpers ----`, `// State`.
- **JSDoc that repeats the name.** `/** The value. */ value`. Say what the reader can't see.
- **A hedge or a sales word.** "Robust", "seamless", "comprehensive", "simply", "just", "easily",
  "ensure", "leverage", "utilize", "note that", "it's important to". Cut the word.
- **A defensive check the types already rule out.** `if (!items) return` on `items: Item[]`, `?? []`
  on a value that's never undefined, `try` around code that can't throw. Delete it; narrow `unknown`
  at a boundary instead.
- **A cast or `!` with no reason.** Make the type right, or say why in a comment.
- **A one-caller helper, or a wrapper that only renames.** Inline it, unless its name explains
  something the call can't.
- **A name that says nothing.** `data`, `result`, `item2`, `handleClick2`, `temp`, `flag`, `isValid2`.
- **An option nobody passes**, a parameter with one value, a config object for one setting.
- **Logs, probes and commented-out code.**
- **In examples, any comment at all.** Only tool directives stay (`svelte-ignore`, `eslint-disable`,
  `@__PURE__`).

What stays: a comment that says why, in three lines at most; the word "primitive"; JSDoc on every
public field and export
([ui-sdk-unslop](https://github.com/vercel-labs/ui/blob/main/.agents/skills/ui-sdk-unslop/SKILL.md)).

## What the gate can see

`check-comments.mjs` implements two rules and states them in its header: "comment-length: a comment
this branch adds or changes runs three lines at most. example-comments: examples have no comments but
tool directives. Prints `file:line rule message` per violation and exits 1 on any"
([check-comments.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-comments.mjs)).

The implementation is deliberately narrow:

- `const maxLines = 3`, and only comments that overlap a changed line are measured. The changed set
  is `git diff -U0 --diff-filter=d <base> -- .` plus untracked files whole, with `base` defaulting to
  `git merge-base HEAD origin/main`
  ([check-comments.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-comments.mjs)).
- `commentsOf(file)` treats a run of `//` lines as one comment, counts `<!-- -->` blocks, skips
  `<!-- @component`, and leaves JSDoc to `check-code`'s public-docs and name-only-docs rules
  ([check-comments.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-comments.mjs)).
- `toolDirective` exempts `///`, `eslint`, `@ts-`, `check-code:`, `svelte-ignore`,
  `prettier-ignore`, `<!-- svelte-ignore` and `@__PURE__`
  ([check-comments.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-comments.mjs)).
- `exampleCode` matches `examples/<a>/<b>/` except `examples/scripts/` and `examples/experiments/`,
  and every comment in a matched file is a violation
  ([check-comments.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-comments.mjs)).
- Two script headers are exempt from the length rule because they document every rule they check
  ([check-comments.mjs](https://github.com/vercel-labs/ui/blob/main/scripts/check-comments.mjs)).

So the gate checks a comment's **length** and an example's **comment count**, not whether a comment
restates the line. That distinction is the whole reason the practice exists: "a comment that says
what the next line does" is decided by reading the line and the comment together and asking whether
the comment adds anything, and a linter sees tokens, not intent.

The assertion half is gateable in this library. `require-safety-comment-for-type-assertion` reports
every non-`const` `as`/`<T>` assertion with no `SAFETY:` comment before it or its containing
statement, and `typescript/ban-ts-comment` rejects `@ts-ignore`-style directives
(`library/templates/oxlint-anti-slop/tools/oxlint/anti-slop/rules/require-safety-comment-for-type-assertion.ts`,
`library/templates/oxlint-anti-slop/oxlint.config.ts`). The gate can require the reason to exist; it
cannot judge whether the reason is true.

## The boundary the skill draws for itself

Step 6 of the skill is the graduation rule: "If one pattern showed up in three or more files, propose
a lint rule for it in `scripts/check-code.mjs` or `scripts/check-comments.mjs`"
([ui-sdk-unslop](https://github.com/vercel-labs/ui/blob/main/.agents/skills/ui-sdk-unslop/SKILL.md)).
A pattern that recurs and is syntactically recognizable becomes a gate; the rest stays prose. That is
the same split this library makes between a practice and its `enforcedBy` recipes.

## Routing

| Practice | Gate? | Where |
| --- | --- | --- |
| `generated-code-cleanup` practice | No gate for the judgement half; `oxlint-anti-slop` / `oxlint-anti-slop-npm` for the machine-checkable slice | `library/practices/generated-code-cleanup.md` |
| `comment-length` recipe | Yes — `comment-length` | `library/recipes/comment-length.md` |
| `comments` practice | No — `comments` | `library/practices/comments.md` |
