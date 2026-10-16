---
id: coverage-ignore-list
title: Ignore a file only when the runner cannot execute it
when: { language: [typescript, javascript], requires: [{ testFile: true }] }
source: research/coverage.md
enforcedBy: [bun-test-coverage, vitest-coverage, oxlint-anti-slop, oxlint-anti-slop-npm]
---

Put a file in the coverage ignore list only when the test runner cannot execute it, never when it merely has not been executed.

The test is "can the test runner execute this file?", not "is this file hard to test?". Three categories pass it. Generated code is not authored, so a floor on it measures the generator rather than the project. A thin process entrypoint that only ever runs as a subprocess is never executed in-process, so it can never reach 100% — the convention is `**/*-bin.ts`. A type-only file compiles to nothing, so it has no executable statements and needs no entry at all; an entry for it is redundant, and a redundant entry is the first step toward an entry that hides something real.

What does not belong is a file that is merely below its floor, a directory excluded to make the number green, or a file whose tests are inconvenient. The distinction is *cannot be executed* versus *has not been executed*. The second case has a legitimate answer that is not an ignore entry: the ratchet records the floor at the level the project measures, so a poorly covered file is a debt to pay down, not a file to hide.

The sub-file escape hatch is a different tool. `/* istanbul ignore next */`, `/* istanbul ignore if */`, `/* v8 ignore if */` and `/* c8 ignore next */` exclude a statement or a branch, not a file, and they are the right tool for a platform branch that cannot run on the test machine. An ignore hint needs the `-- @preserve` marker to survive the transpiler's comment stripping; without it the hint is not an error, it is a comment that no longer exists by the time the instrumenter sees the file, so the line it was meant to exclude fails the gate and the author cannot see why.
