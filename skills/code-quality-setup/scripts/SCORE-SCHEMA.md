# `score.mjs` — the score view and the baseline schema

`node scripts/score.mjs [projectDir] [--raise] [--json]` reads each gate's artifact from the
project and prints the per-gate level, with fallow's health score (the maintainability level) as
the headline. Zero dependencies, node builtins only, no package manager invoked, **runs no gate**:
the artifacts must already exist. Exit 0 on a report; exit 1 when there is nothing to report, when
a regression is found, or when `--raise` is refused.

This file is the contract for the score view and for `.code-quality-baseline.json`, the committed
floor file. The artifact each gate writes is specified in the gate-artifacts research
(`research/gate-artifacts.md` on the `research/gate-artifacts` branch); the ratchet's semantics are
settled in [#62](https://github.com/Gott50/code-quality-skills/issues/62).

## Options

| Option | Effect |
|---|---|
| `[projectDir]` | the project to score (default `.`) |
| `--raise` | re-measure and write `.code-quality-baseline.json` — the current level becomes the new floor. Refuses when any artifact is unreadable, so a floor is never silently dropped. |
| `--json` | print the machine-readable score document (below) instead of the text report |

## Artifacts

The path is relative to the project root. The first three are the paths the recipes already fix;
the last four are captured stdout — those tools write no file of their own, so the score view reads
a capture.

| Gate | Path | Capture |
|---|---|---|
| coverage (bun) | `coverage/lcov.info` | `bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage` |
| coverage (vitest) | `coverage/coverage-final.json` | `vitest run --coverage` (istanbul `json` reporter) |
| mutation | `reports/mutation/report.json` | `stryker run` (the `jsonReporter` path) |
| lint | `reports/oxlint.json` | `oxlint --format json > reports/oxlint.json` |
| typecheck | `reports/tsc.log` | `tsc --noEmit --pretty false > reports/tsc.log` |
| fallow health | `reports/fallow-health.json` | `fallow health --format json --report-only > reports/fallow-health.json` |
| fallow dead-code | `reports/fallow-dead-code.json` | `fallow dead-code --format json > reports/fallow-dead-code.json` |

A gate whose artifact is absent is simply not reported. A malformed artifact is reported in the
report's **warnings** and the gate is omitted — one broken file must not cost the user the whole
score. When no artifact at all is found, the run exits 1 with a message.

## The per-gate level

| Gate | Level | Read |
|---|---|---|
| coverage | per file `{ hit, found }`; global = the sum | lcov: `LH`/`LF` (lines). Istanbul: statements hit / statements found from the `s` map. bun's lcov is preferred when both exist. |
| mutation | per file `{ killed, total }`; global = the sum | `files[path].mutants[].status`; `killed` = `Killed`, `total` = every mutant in the file. The report carries no score. |
| lint | one global count | `diagnostics.length` of `oxlint --format json` |
| typecheck | one global count | the lines of `tsc --noEmit --pretty false` matching `: error TS\d+` |
| fallow health | `health_score.score` (0–100) + `.grade`, with `summary.average_maintainability` and the worst `file_scores[].crap_max` | the only ready-made 0–100 level |
| fallow dead-code | one global count | `total_issues` |

The Istanbul key is an absolute path; it is relativized to the project root (trying the root and
its realpath, because on macOS `/tmp` is a symlink to `/private/tmp`). lcov and Stryker keys are
already project-relative.

## The text report

```
Quality score — /tmp/proj

  fallow health   70.0 (B)   maintainability 82.3   CRAP max 156   ← headline

  coverage        75.0%  (3/4)
  mutation        75.0%  (3/4)
  lint            3
  typecheck       2
  dead code       4

  baseline        .code-quality-baseline.json (schemaVersion 1)
  verdict         no regression
```

The headline is fallow's health score — the map's "fallow maintainability" — with the
maintainability average and the worst CRAP beside it. `—` marks a gate whose artifact is absent.
The **verdict** is one of:

| Verdict | Meaning |
|---|---|
| `no regression` | a baseline is present and every floor holds |
| `REGRESSION — N below the floor` | N floors are breached; each is listed below the verdict |
| `baseline stale — a recorded tool version changed; re-measure (--raise)` | a recorded tool version differs from the current one, so the baseline is invalidated (#62) |
| `no baseline — run --raise to record one` | no `.code-quality-baseline.json` yet |

A regression lists each breach as `coverage src/x.ts: 33.3% (1/3) < floor 66.7% (2/3)` (or
`lint: 5 > floor 3` for a count). A version mismatch lists `fallow: recorded 3.19.0, current
3.33.1`. `--raise` appends `baseline written: .code-quality-baseline.json`.

## The baseline schema

`.code-quality-baseline.json` is the committed floor file, separate from `.code-quality.json`
(which records what was applied, not quality levels). It holds coverage, mutation, lint and
typecheck; **fallow's floors stay in fallow's own baseline files** (health, dead-code, dupes — each
its own format, per [#77](https://github.com/Gott50/code-quality-skills/issues/77)).

```json
{
  "schemaVersion": 1,
  "versions": {
    "skill": "1",
    "bun": "1.4.2",
    "vitest": "^5.0.3",
    "stryker": "^10.0.0",
    "oxlint": "^1.87.0",
    "typescript": "^5.6.0",
    "fallow": "3.19.0"
  },
  "gates": {
    "coverage": {
      "global": { "hit": 34, "found": 60 },
      "files": { "src/x.ts": { "hit": 34, "found": 60 } }
    },
    "mutation": {
      "global": { "killed": 8, "total": 10 },
      "files": { "src/x.ts": { "killed": 8, "total": 10 } }
    },
    "lint": { "global": 3 },
    "typecheck": { "global": 0 }
  }
}
```

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `versions` | the declared version of each tool (below); `null` when the project does not declare it |
| `gates.coverage` / `gates.mutation` | `global` plus one entry per file, as **exact fractions** — never a rounded ratio |
| `gates.lint` / `gates.typecheck` | one global count |

A gate whose artifact was absent is omitted from `gates`. The file is written in the canonical form
a committed JSON file must have to survive the formatter recipes' `biome check .`: **keys sorted,
two spaces of indent, a trailing newline** — the same convention `manifest.mjs` writes
`.code-quality.json` in. `--raise` is idempotent: re-raising an unchanged project rewrites the same
bytes.

## The comparison

`>=` on the exact recorded value, no tolerance (#62):

- **coverage / mutation** — per-file floors. A recorded file's fraction must hold
  (`hit/found >= the recorded fraction`, cross-multiplied so no float rounding creeps in). A
  **new** file must meet the recorded **global** floor. A **deleted** file is not a regression —
  its entry drops on the next raise. The global fraction must also hold.
- **lint / typecheck** — one global count; the current count must be `<=` the recorded count.
- **fallow health / dead-code** — printed, never compared here; fallow's own baseline files are the
  floor.

A gate with nothing to measure (`found`/`total` 0) is 100%.

## Versions

The `versions` block records the declared version of each tool, read from the project's
`package.json` (`dependencies` or `devDependencies`); `bun` comes from the `packageManager` field
(`bun@1.4.2` → `1.4.2`). `skill` is the skill's own version constant — the skill ships no
`package.json`. A tool the project does not declare is `null`.

A recorded tool version changing **invalidates the baseline** (#62): the plan asks to re-measure, so
the verdict is `baseline stale` and the run exits 0. Only a change between two known versions
counts — an unknown version cannot be said to have moved.

## `--json`

`--json` prints one JSON document instead of the text report, in the same canonical form:

```jsonc
{
  "schemaVersion": 1,
  "root": "/tmp/proj",
  "headline": { "gate": "fallow-health", "score": 70, "grade": "B" },
  "gates": {
    "coverage": { "source": "lcov", "global": { "hit": 3, "found": 4 }, "files": { "src/x.ts": { "hit": 2, "found": 3 } } },
    "mutation": { "global": { "killed": 3, "total": 4 }, "files": { "src/x.ts": { "killed": 2, "total": 3 } } },
    "lint": { "global": 3 },
    "typecheck": { "global": 2 },
    "fallowHealth": { "score": 70, "grade": "B", "maintainability": 82.3, "crapMax": 156 },
    "fallowDeadCode": { "global": 4 }
  },
  "baseline": { "present": true, "path": ".code-quality-baseline.json", "schemaVersion": 1, "error": null, "versionMismatch": [] },
  "verdict": { "state": "ok", "regressions": [] },
  "errors": [],
  "raised": false
}
```

`verdict.state` is `ok` / `regression` / `stale` / `no-baseline` — the text report's verdict.
`baseline.error` is the parse error when the file exists but is unreadable. `errors` is the
per-gate warnings. `raised` is true when `--raise` wrote the file.

## Exit codes

| Code | When |
|---|---|
| 0 | a report was printed and no regression was found (including `stale` and `no-baseline`) |
| 1 | a regression was found; no artifact was found; the target is not a directory; `--raise` was refused |

## What it does not do

- No gate is run, no package manager, no network. The artifacts must already exist.
- No fallow baseline is written — fallow's floors live in fallow's own files.
- No history or trend: the committed floor is the whole state.
