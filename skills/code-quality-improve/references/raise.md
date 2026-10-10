# Raising a floor

The floor never rises on its own. The gates are read-only checks; only the raise step moves a floor,
and only after a change has been verified. The raise is the sibling `code-quality-setup` skill's
`score.mjs --raise` for the unified gates, and the project's own `fallow:raise` script for fallow's
gates — this skill invokes them, it does not reimplement the merge.

| Gate | Floor lives in | Artifact the raise re-measures | Raise |
|---|---|---|---|
| coverage | `.code-quality-baseline.json` → `gates.coverage` | `coverage/lcov.info` (bun) or `coverage/coverage-final.json` (vitest) | `node <code-quality-setup>/scripts/score.mjs <projectDir> --raise` |
| mutation | `.code-quality-baseline.json` → `gates.mutation` | `reports/mutation/report.json` | `node <code-quality-setup>/scripts/score.mjs <projectDir> --raise` |
| lint | `.code-quality-baseline.json` → `gates.lint` | `reports/oxlint.json` | `node <code-quality-setup>/scripts/score.mjs <projectDir> --raise` |
| typecheck | `.code-quality-baseline.json` → `gates.typecheck` | `reports/tsc.log` | `node <code-quality-setup>/scripts/score.mjs <projectDir> --raise` |
| fallow-health | `.fallow-health-baseline.json` | `reports/fallow-health.json` | `bun run fallow:raise` (or `npm run fallow:raise`) |
| fallow-dead-code | `.fallow-dead-code-baseline.json` | `reports/fallow-dead-code.json` | `bun run fallow:raise` (or `npm run fallow:raise`) |

`<code-quality-setup>` is the sibling skill's directory — the skills CLI installs each skill at
`<skills root>/<name>/`, so it sits next to this one (`.agents/skills/code-quality-setup/`). The
ranking prints the resolved command per target.

## The merge

`--raise` **merges** with the recorded baseline; the floor never falls:

- coverage and mutation — per file and global, the **larger** of the current and recorded fractions,
  per metric. A current fraction with nothing to measure never lowers a recorded floor. A recorded
  file the artifact no longer lists is a deleted file and its entry drops; a new file is added at its
  current fraction.
- lint and typecheck — the **smaller** of the current and recorded counts (a count is a ceiling).
- a recorded gate whose artifact is absent is **kept**, never dropped.
- a gate with no recorded floor takes the current level.

So a repo already above its floor keeps the higher level, and a repo below its floor stays red —
`--raise` does not lower a floor to make a gate green. The full semantics are in the sibling skill's
`scripts/SCORE-SCHEMA.md`.

## A resistant target

When a change does not move the level, or the gate still fails, report it as-is: leave the floor
where it is and move to the next target. Never lower a floor to make a gate green.
