# `rank.mjs` — the ranking view

`node scripts/rank.mjs [projectDir] [--json]` reads the artifacts the gates already produced and
prints the ranked improvement targets: the coverage gaps, the mutation gaps, lint violations and
typecheck errors folded in as candidates, then fallow's own `--targets` ranking. Zero dependencies,
node builtins only, no package manager invoked, **runs no gate**: the artifacts must already exist.
Exit 0 on a report; exit 1 only when the target is not a directory.

The readers are this skill's own, not an import from the sibling `code-quality-setup` skill: the
skills CLI copies one skill directory per install, so a relative import across skill directories
would not resolve in a consumer's project. The one thing this skill does not reimplement is the
floor merge — the raise step invokes the sibling's `score.mjs --raise` (see The raise command).

## Options

| Option | Effect |
|---|---|
| `[projectDir]` | the project to rank (default `.`) |
| `--json` | print the machine-readable report (below) instead of the text report |

## Sources

The path is relative to the project root. A missing artifact is a **gap** — reported with its
capture command — never a crash. A malformed artifact is a gap too.

| Source | Artifact | Capture | Read |
|---|---|---|---|
| fallow targets | `reports/fallow-targets.json` | `fallow health --targets --format json > reports/fallow-targets.json` | the `targets` array; the key is **omitted** when there are no targets, so a missing key is an empty list |
| coverage (bun) | `coverage/lcov.info` | `bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage` | per file `lines` from `LH`/`LF`, `functions` from `FNH`/`FNF` |
| coverage (vitest) | `coverage/coverage-final.json` | `vitest run --coverage` | per file `statements` from the `s` map, `functions` from the `f` map; the key is relativized to the project root |
| mutation | `reports/mutation/report.json` | `stryker run` | `files[path].mutants[]`; a mutant whose `status` is neither `Killed` nor `Ignored` is a gap, carrying its `location.start.line`, `status` and `mutatorName` |
| lint | `reports/oxlint.json` | `oxlint --format json > reports/oxlint.json` | `diagnostics[]`, grouped by `filename` |
| typecheck | `reports/tsc.log` | `tsc --noEmit --pretty false > reports/tsc.log` | the lines matching `: error TS\d+`, grouped by the file before the `(l,c)` |
| floors | `.code-quality-baseline.json` | written by `score.mjs --raise` | the recorded floors, for the `below floor` marks and the lint/typecheck floors |

bun's lcov is preferred when both coverage artifacts exist. The fallow targets are a captured
stdout — fallow writes no file of its own — like the score view's captures.

## The ranking

One list, ordered by **effort tier, cheap first**, then by the source's own order:

| Tier | Candidates | Within the tier |
|---|---|---|
| 0 | the folded-in candidates — coverage, mutation, lint, typecheck | the group order (coverage, mutation, lint, typecheck), each group already ordered by severity |
| 1 | fallow targets with `effort: "low"` | fallow's own order — `efficiency` (`priority ÷ effort`) descending, then `confidence` high→medium→low (a further tie keeps fallow's own order) |
| 2 | fallow targets with `effort: "medium"` | as tier 1 |
| 3 | fallow targets with `effort: "high"` | as tier 1 |
| 4 | fallow targets whose capture carried no `effort` | as tier 1 |

**Why the folded-in candidates lead.** They are repo-owned: the artifact already exists and the fix
needs no new harness, so the repo can take one on the first pass. fallow's `effort` is a static
estimate of the refactoring, not of the repo's readiness — on a repo with no DOM test harness,
`add_test_coverage` for a DOM file is estimated `medium` but is in fact the most expensive target on
the list ([#97](https://github.com/Gott50/code-quality-skills/issues/97)). So the repo-owned
candidates come first, and fallow's targets follow by their own effort tier.

**Why fallow's own ranking is kept.** Within a tier, fallow's targets keep fallow's own order
(`efficiency` descending — fallow's default sort), so the reorder only moves a target across effort
tiers, never within one. Every fallow line also prints fallow's own rank (`fallow #N`), so its
ranking stays visible even when a target moves down.

**Why confidence is a tiebreaker.** Two targets of the same effort and priority have the same
`efficiency`; `confidence` (high → medium → low) then decides, so a high-confidence target surfaces
above a low-confidence one. A further tie keeps fallow's own order — the sort is stable.

The rank is 1-based across the whole list.

The folded-in candidates, in their group order:

1. **coverage gaps** — files with uncovered lines or functions, by uncovered count descending, then
   path. A file at 100% on every metric is not a gap.
2. **mutation gaps** — one candidate per mutant the suite did not kill, by file (gap count
   descending, then path), then line. A mutant whose `status` is `Killed` (the test caught it) or
   `Ignored` (a deliberate exclusion) is not a gap; `Survived`, `NoCoverage`, `Timeout`,
   `RuntimeError` and `CompileError` are. The project's own mutation gate counts `killed` as
   `Killed` only and `total` as every mutant, so a `RuntimeError` mutant holds the file's level
   below 100% exactly like a survivor
   ([#95](https://github.com/Gott50/code-quality-skills/issues/95)).
3. **lint violations** — files with diagnostics, by count descending, then path.
4. **typecheck errors** — files with errors, by count descending, then path.

A fallow target carries fallow's structured ranking: `priority`, `efficiency`, `effort`,
`confidence`, `category`, `recommendation`, `factors[]`, `evidence`, `actions[]`, plus `fallowRank`
(its 1-based position in fallow's own list).

A coverage target is marked `⚠ below floor` when the file breaches its recorded floor — the
per-file floor when the baseline records one, else the global floor (a new file gets the project's
global floor, [#62](https://github.com/Gott50/code-quality-skills/issues/62)). A mutation target is
marked the same way, on its file's `killed`/`total` level. A lint or typecheck source line is marked
`⚠ above floor` when the global count exceeds the recorded count.

## The text report

```
Improvement targets — /tmp/proj

  baseline        .code-quality-baseline.json (schemaVersion 1)
  fallow          reports/fallow-targets.json — 1 target(s)
  coverage        coverage/lcov.info — 2 file(s) with uncovered lines or functions
  mutation        reports/mutation/report.json — 1 gap(s) in 1 file(s)
  lint            reports/oxlint.json — 3 diagnostic(s) in 2 file(s)   floor 2   ⚠ above floor
  typecheck       reports/tsc.log — 3 error(s) in 2 file(s)   floor 0   ⚠ above floor

  1. [coverage] src/user0.ts   functions 100.0% (1/1)  lines 50.0% (1/2)   uncovered 1   effort —  confidence —   ⚠ below floor
     raise: node .agents/skills/code-quality-setup/scripts/score.mjs . --raise
  2. [mutation] src/gate.ts:30   RuntimeError StringLiteral   effort —  confidence —
     raise: node .agents/skills/code-quality-setup/scripts/score.mjs . --raise
  3. [lint] src/lintme.ts   2 diagnostic(s)   effort —  confidence —
     raise: node .agents/skills/code-quality-setup/scripts/score.mjs . --raise
  4. [fallow] src/core.ts   priority 60  efficiency 20  effort high  confidence medium   fallow #1
     split_high_impact — Split high-impact file (5 LOC), 12 dependents amplify every change
     factors: complexity_density 2.8 > 0.3; fan_in 12 > 12; dead_code_ratio 0.75 > 0.5
     evidence: direct_callers 5
     actions: apply-refactoring; suppress-line
     raise: bun run fallow:raise
```

`— absent` marks a source whose artifact is missing; `— unreadable: …` marks a malformed one. When
no target is found the report says `no targets — nothing to rank.` and the **gaps** section lists
every missing artifact with its capture command.

## The raise command

Each target carries the command that raises its gate's floor:

| Gate | Raise |
|---|---|
| coverage, mutation, lint, typecheck | `node <code-quality-setup>/scripts/score.mjs <projectDir> --raise` |
| fallow-health, fallow-dead-code | `<package manager> run fallow:raise` |

The sibling `score.mjs` is resolved from this script's own location (the skills CLI installs each
skill at `<skills root>/<name>/`, so the sibling sits next to this one). When it is absent the
command reads `install code-quality-setup to raise the unified floor`. The package manager is read
from the project's lockfile, then its `packageManager` field.

## `--json`

`--json` prints one JSON document instead of the text report, in the canonical form a committed
JSON file must have to survive the formatter recipes' `biome check .` (keys sorted, two spaces of
indent, a trailing newline):

```jsonc
{
  "schemaVersion": 2,
  "root": "/tmp/proj",
  "sources": {
    "baseline": { "path": ".code-quality-baseline.json", "present": true, "schemaVersion": 1, "error": null },
    "fallow": { "path": "reports/fallow-targets.json", "present": true, "count": 1, "error": null },
    "coverage": { "path": "coverage/lcov.info", "present": true, "source": "lcov", "files": 2, "error": null },
    "mutation": { "path": "reports/mutation/report.json", "present": true, "gaps": 1, "files": 1, "error": null },
    "lint": { "path": "reports/oxlint.json", "present": true, "count": 3, "files": 2, "floor": 2, "error": null },
    "typecheck": { "path": "reports/tsc.log", "present": true, "count": 3, "files": 2, "floor": 0, "error": null }
  },
  "gaps": [{ "source": "baseline", "path": ".code-quality-baseline.json", "reason": "absent — …" }],
  "targets": [
    {
      "rank": 1,
      "source": "coverage",
      "path": "src/user0.ts",
      "gate": "coverage",
      "detail": "1 uncovered",
      "metrics": { "functions": { "hit": 1, "found": 1 }, "lines": { "hit": 1, "found": 2 } },
      "uncovered": 1,
      "belowFloor": true,
      "effort": null,
      "confidence": null,
      "raise": "node .agents/skills/code-quality-setup/scripts/score.mjs . --raise"
    },
    {
      "rank": 2,
      "source": "mutation",
      "path": "src/gate.ts",
      "gate": "mutation",
      "line": 30,
      "status": "RuntimeError",
      "mutatorName": "StringLiteral",
      "detail": "RuntimeError StringLiteral",
      "belowFloor": false,
      "effort": null,
      "confidence": null,
      "raise": "node .agents/skills/code-quality-setup/scripts/score.mjs . --raise"
    },
    { "rank": 3, "source": "lint", "path": "src/lintme.ts", "gate": "lint", "detail": "2 diagnostic(s)", "count": 2, "effort": null, "confidence": null, "raise": "…" },
    {
      "rank": 4,
      "source": "fallow",
      "path": "src/core.ts",
      "gate": "fallow-health",
      "detail": "Split high-impact file (5 LOC), 12 dependents amplify every change",
      "priority": 60,
      "efficiency": 20,
      "effort": "high",
      "confidence": "medium",
      "fallowRank": 1,
      "category": "split_high_impact",
      "factors": [{ "metric": "fan_in", "value": 12, "threshold": 12, "detail": "12 files depend on this" }],
      "evidence": { "direct_callers": [] },
      "actions": [{ "type": "apply-refactoring", "auto_fixable": false, "description": "…" }],
      "raise": "bun run fallow:raise"
    }
  ]
}
```

A fallow target's `gate` is `fallow-dead-code` when its `category` is `remove_dead_code`, else
`fallow-health`. Every target carries `effort` and `confidence` — `null` when the source has none
(the folded-in candidates) — and the array is in the ranking order above. A fallow target also
carries `fallowRank`, its 1-based position in fallow's own list. A coverage target carries `metrics`
(per metric `{ hit, found }`), `uncovered` and `belowFloor`; a mutation target carries `line`,
`status`, `mutatorName` and `belowFloor`; a lint or typecheck target carries `count`.

## Exit codes

| Code | When |
|---|---|
| 0 | a report was printed — targets or gaps |
| 1 | the target is not a directory |

## What it does not do

- No gate is run, no package manager, no network. The artifacts must already exist.
- No floor is written — the raise step invokes the sibling `score.mjs --raise`.
- No change is made — the skill makes the change, on approval.
