---
id: tsconfig-strictness
title: `strict` is the floor; go past it deliberately
when: { language: [typescript, javascript], requires: [{ file: package.json }] }
source: research/lint-typecheck.md
enforcedBy: [tsconfig-strict, tsconfig-strict-npm]
---

Turn on `strict` and add the stricter options one at a time, with the code changed to match.

`strict` is the floor everyone agrees on: it turns on the whole strict-mode family at once. It is
also a moving target, because a future compiler version may add a check under the same flag. A
project that pins its compiler version and turns on `strict` gets a stable floor; one that floats
gets new errors on upgrade, which is the flag working as designed.

Past `strict` the options are a choice, not a default. Adding `undefined` to every indexed access,
or refusing `undefined` for an optional property, catches real bugs and is often unwieldy in
real-world code — the compiler's own documentation says so. The right move is to add one option, fix
the code it flags, and only then add the next.

The config can enforce whichever set the project chose; it cannot decide the set. A project that
turns on the strictest options and then suppresses the errors has paid the cost and bought nothing.
