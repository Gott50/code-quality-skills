#!/usr/bin/env bash
# THROWAWAY: the manual application of the two prototype recipes to a scratch TypeScript project.
set -uo pipefail
F=/tmp/cqs-fixture

echo "##### 1. scratch project"
rm -rf "$F"; mkdir -p "$F/src" "$F/test"
cd "$F"
printf '%s\n' '{' '  "name": "cqs-fixture",' '  "private": true,' '  "type": "module",' '  "scripts": {' '    "test": "bun test"' '  }' '}' > package.json
printf '%s\n' '{' '  "compilerOptions": {' '    "strict": true,' '    "noEmit": true,' '    "module": "esnext",' '    "moduleResolution": "bundler",' '    "target": "esnext",' '    "types": ["bun"]' '  },' '  "include": ["src", "test"]' '}' > tsconfig.json
printf '%s\n' 'export function add(a: number, b: number): number {' '  return a + b;' '}' > src/index.ts
printf '%s\n' 'import { expect, test } from "bun:test";' 'import { add } from "../src/index";' '' 'test("adds", () => {' '  expect(add(1, 2)).toBe(3);' '});' > test/index.test.ts
git init -q . && git add -A && git -c user.email=a@b -c user.name=fixture commit -qm "fixture base"

echo; echo "##### 2. apply both recipes (first run)"
node /tmp/apply.mjs "$F"; echo "apply exit=$?"

echo; echo "##### 3. apply again (idempotency)"
node /tmp/apply.mjs "$F"; echo "apply exit=$?"

echo; echo "##### 4. the pre-commit hook, end to end"
printf '%s\n' 'import { b } from "z";' 'import { a } from "a";' 'export const o = { z: 1, a: 2 };' > src/unsorted.ts
git add src/unsorted.ts
git -c user.email=a@b -c user.name=fixture commit -qm "add unsorted file" || echo "commit FAILED"
echo "--- committed content of src/unsorted.ts ---"
git show HEAD:src/unsorted.ts
echo "--- worktree content ---"
cat src/unsorted.ts
echo "--- is the commit clean under the gate? ---"
bunx @biomejs/biome check src/unsorted.ts && echo "clean" || echo "DIRTY"

echo; echo "##### 5. resulting tree"
git add -A >/dev/null 2>&1
git status --short
find . -type f -not -path "./.git/*" -not -path "./node_modules/*" -not -path "./.husky/_/*" | sort
