# comment-debt-ts

The apply target for the `comment-length` recipe: a TypeScript project that carries two comment
findings, so the gate's warn-then-fail behavior is reproducible from the fixture alone.

## Two commits

The fixture is committed in two commits on the branch that adds it:

1. **The skeleton** — `32a9331543792a52f3c02aaa47c4396fe6c363d1`. No comment finding:
   `src/index.ts` and `examples/basic/demo/index.ts` are bare, and `.comment-length.json` records
   `{ "maxLines": 3, "warnings": 0 }`.
2. **The violations** — this commit. `src/index.ts` gains a four-line comment (one `comment-length`
   finding) and `examples/basic/demo/index.ts` gains a comment (one `example-comments` finding), and
   the marker records `{ "maxLines": 3, "warnings": 2 }`.

The skeleton is the base the gate diffs against; the second commit is the change it measures.

## The marker

`.comment-length.json` is the project's opt-in, and the recipe never writes it. `maxLines` is the
cap (default 3) and `warnings` is the recorded count (default 0): the gate prints every violation
and fails only when the count exceeds the recorded one. This fixture records 2, so the gate passes
on the commit that introduces the two findings — the adoption shape the recipe documents.

Set `warnings` to 0 to see it fail:

```sh
printf '{\n  "maxLines": 3,\n  "warnings": 0\n}\n' > .comment-length.json
```

## Proof

The recipe's apply writes `scripts/check-comments.mjs`; copy it in first if the recipe has not been
applied:

```sh
mkdir -p scripts
cp <library>/templates/comment-length/scripts/check-comments.mjs scripts/
```

Then, from the fixture root:

```sh
node scripts/check-comments.mjs --base 32a9331543792a52f3c02aaa47c4396fe6c363d1
```

prints the two violations and exits 0, because the marker records 2. The script resolves diff paths
relative to the directory it runs in, so the fixture root works even though it sits inside this
repo. The `--staged` scope is the hook's:

```sh
git add -A && node scripts/check-comments.mjs --staged
```

Run it in a copy of the fixture that is its own git repository (`fixtures/README.md`), where the
change is uncommitted: `git reset --soft <skeleton-sha>` leaves the second commit's tree staged
against the skeleton. `git add -A` there stages the copy, not this repo. With `warnings` at 0
either command exits 1 and prints:

```
src/index.ts:1 comment-length a comment runs 4 lines; the cap is 3
examples/basic/demo/index.ts:1 example-comments examples carry no comments but tool directives
```
