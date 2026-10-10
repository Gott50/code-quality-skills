---
name: code-quality-improve
description: Raises a TypeScript repo's code-quality score one target at a time. Use when a repo already has code-quality gates and a committed baseline and the user wants to improve coverage, mutation, lint, typecheck, dead code or complexity without regressing.
---

# code-quality-improve

Raise a repo's code-quality floor one target at a time. The skill ranks the improvement targets, prints the ranking, and — on approval — makes one change, verifies it, and raises that gate's floor. It writes files and commits; never run it unprompted.

It is the companion to `code-quality-setup`: that skill installs the gates and records the baseline, this one raises the floors. Install both.

## The loop

**rank → show → change → verify → raise.** One target per pass.

### 1. Rank

Capture the artifacts the gates produce, then print the ranking verbatim. Never improvise the ranking.

```
node scripts/rank.mjs [projectDir] [--json]   # default projectDir: .
```

`rank.mjs` reads the artifacts and writes nothing. It never runs a gate and never invokes a package manager. The ranking is fallow's own `--targets` ranking first, then the coverage gaps, mutation gaps, lint violations and typecheck errors folded in as additional candidates. A missing artifact is a reported gap, not a crash — the gap names the capture command.

The artifacts it reads, all relative to the project root:

| Source | Artifact | Capture |
|---|---|---|
| fallow targets | `reports/fallow-targets.json` | `fallow health --targets --format json > reports/fallow-targets.json` |
| coverage (bun) | `coverage/lcov.info` | `bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage` |
| coverage (vitest) | `coverage/coverage-final.json` | `vitest run --coverage` |
| mutation | `reports/mutation/report.json` | `stryker run` |
| lint | `reports/oxlint.json` | `oxlint --format json > reports/oxlint.json` |
| typecheck | `reports/tsc.log` | `tsc --noEmit --pretty false > reports/tsc.log` |
| floors | `.code-quality-baseline.json` | written by `score.mjs --raise` |

The output shape is [scripts/RANK-SCHEMA.md](scripts/RANK-SCHEMA.md).

### 2. Show

Print the ranking and ask once. **Nothing is written before the user approves the printed ranking.** The authority is the same as `code-quality-setup`: audit → propose → apply on approval.

### 3. Change

Make the one approved change — the ranking's next entry, or the target the user names. One target per pass.

### 4. Verify

Re-run the gates the change touches and re-capture their artifacts. The change is verified when the gate passes at the recorded floor and the target's level improved. A gate whose artifact cannot be read is a reported gap, not a pass.

### 5. Raise

Raise that gate's floor to the level just measured, then commit the change and the raised floor together:

| Gate | Raise |
|---|---|
| coverage, mutation, lint, typecheck | `node <code-quality-setup>/scripts/score.mjs <projectDir> --raise` |
| fallow-health, fallow-dead-code | `bun run fallow:raise` (or `npm run fallow:raise`) |

The raise is the sibling skill's `score.mjs --raise` — this skill invokes it, it does not reimplement the merge. The floor never falls: `--raise` merges, so a gate already above its floor keeps the higher level. The per-gate floor, artifact and raise command are in [references/raise.md](references/raise.md).

### A resistant target

A target that resists — the change does not move the level, or the gate still fails — is reported as-is. Leave the floor where it is and move to the next target. Never lower a floor to make a gate green.

## Reference

- [scripts/RANK-SCHEMA.md](scripts/RANK-SCHEMA.md) — the ranking's output contract.
- [references/raise.md](references/raise.md) — the per-gate floor, artifact and raise command.
