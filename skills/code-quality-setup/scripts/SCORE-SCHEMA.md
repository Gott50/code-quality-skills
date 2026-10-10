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
| `--raise` | re-measure and write `.code-quality-baseline.json`, **merging** with the recorded baseline: the floor never falls (see The adoption flow's measure step). Refuses when any artifact is unreadable, so a floor is never silently dropped. |
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
| coverage | per file one `{ hit, found }` per metric; global = the sum per metric | lcov: `lines` from `LH`/`LF`, `functions` from `FNH`/`FNF`. Istanbul: `statements` from the `s` map, `functions` from the `f` map. bun's lcov is preferred when both exist. |
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

  coverage        lines 75.0% (3/4)  functions 0.0% (0/1)
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

A regression lists each breach as `coverage src/x.ts lines: 33.3% (1/3) < floor 66.7% (2/3)` (or
`lint: 5 > floor 3` for a count). A coverage breach names the metric that fell; a mutation breach
carries no metric name. A version mismatch lists `fallow: recorded 3.19.0, current
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
    "node": null,
    "vitest": "^5.0.3",
    "stryker": "^10.0.0",
    "oxlint": "^1.87.0",
    "typescript": "^5.6.0",
    "fallow": "3.19.0"
  },
  "gates": {
    "coverage": {
      "global": { "lines": { "hit": 34, "found": 60 }, "functions": { "hit": 5, "found": 10 } },
      "files": {
        "src/x.ts": { "lines": { "hit": 34, "found": 60 }, "functions": { "hit": 5, "found": 10 } }
      }
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
| `gates.coverage` | `global` plus one entry per file, each a map of **metric → exact fraction** — never a rounded ratio. The metric names come from the source: `lines`/`functions` for bun's lcov, `statements`/`functions` for vitest's Istanbul |
| `gates.mutation` | `global` plus one entry per file, as **exact fractions** — never a rounded ratio |
| `gates.lint` / `gates.typecheck` | one global count |

The coverage floor carries **both metrics** because both gates enforce both: `coverage-gate.ts`
reads lcov `LH`/`LF` and `FNH`/`FNF`, `coverage-gate.mjs` reads Istanbul's `s` and `f` maps. A
single recorded fraction would be enforced on two metrics, so a file at 4/10 lines and 0/1
functions would fail the moment the floor was raised to its own line level. Each metric is recorded
and enforced on its own.

`schemaVersion` stays `1`: the ratchet is unreleased, so no baseline has ever been written by a
shipped skill and the shape changes in place. A future shape change after the first release bumps
it.

A gate whose artifact was absent is omitted from `gates`. The file is written in the canonical form
a committed JSON file must have to survive the formatter recipes' `biome check .`: **keys sorted,
two spaces of indent, a trailing newline** — the same convention `manifest.mjs` writes
`.code-quality.json` in. `--raise` is idempotent: re-raising an unchanged project rewrites the same
bytes.

## The comparison

`>=` on the exact recorded value, no tolerance (#62):

- **coverage** — per-file floors, one per metric. A recorded file's fraction must hold **for each
  metric** (`hit/found >= the recorded fraction`, cross-multiplied so no float rounding creeps in).
  A **new** file must meet the recorded **global** floor on each metric. A **deleted** file is not a
  regression — its entry drops on the next raise. The global fraction must also hold, per metric.
- **mutation** — per-file floors. A recorded file's fraction must hold
  (`killed/total >= the recorded fraction`, cross-multiplied so no float rounding creeps in). A
  **new** file must meet the recorded **global** floor. A **deleted** file is not a regression —
  its entry drops on the next raise. The global fraction must also hold.
- **lint / typecheck** — one global count; the current count must be `<=` the recorded count.
- **fallow health / dead-code** — printed, never compared here; fallow's own baseline files are the
  floor.

A gate with nothing to measure (`found`/`total` 0) is 100%.

## Versions

The `versions` block records the declared version of each tool, read from the project's
`package.json` (`dependencies` or `devDependencies`). The runtime is read from the pin the project
declares: `bun` from the `packageManager` field (`bun@1.4.2` → `1.4.2`), else the `.bun-version`
file the `repo-hygiene` recipe writes; `node` from the `.node-version` file the `repo-hygiene-npm`
recipe writes. A pin file's version is its first non-empty line, trimmed, with a leading `v`
dropped. The recipes pin the runtime in these files and CI reads them through `bun-version-file` /
`node-version-file`, so the recorded versions cover the runtime the recipes pin
([#96](https://github.com/Gott50/code-quality-skills/issues/96)). `skill` is the skill's own version
constant — the skill ships no `package.json`. A tool the project does not declare is `null`.

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
    "coverage": { "source": "lcov", "global": { "lines": { "hit": 3, "found": 4 }, "functions": { "hit": 1, "found": 2 } }, "files": { "src/x.ts": { "lines": { "hit": 2, "found": 3 }, "functions": { "hit": 1, "found": 2 } } } },
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

## The adoption flow's measure step

`plan.mjs` imports `measure` (and the artifact readers) from this file for the plan's **Measurement**
section (#67): the level each gate the selection will install measures now, and the floor the apply
will install. The plan reads the artifacts and the baseline that already exist and writes nothing; an
absent artifact is `_unmeasured_`, and a gate with no recorded floor falls back to the greenfield
wall. The plan's output is specified in `PLAN-SCHEMA.md` → The measurement.

The apply then produces the authoritative measurement and writes the floor at it:

1. **capture** — run each selected gate's capture command (the Artifacts table above), with the
   config the apply just wrote, so the artifact is the level the installed gate measures. The
   recipe's `commands` only install packages; the artifacts come from these captures;
2. `node scripts/score.mjs <projectDir> --raise` re-measures from those artifacts and writes
   `.code-quality-baseline.json` — the unified floor for coverage, mutation, lint and typecheck;
3. the fallow-audit recipe's `fallow:raise` writes fallow's own floor files.

`--raise` **merges** with the recorded baseline, it does not overwrite it: the floor never falls.
Per gate:

| Gate | Merge rule |
|---|---|
| coverage | per file and global, the **larger** of the current and recorded fractions **per metric** (cross-multiplied, the same comparison `atLeast` makes). A current fraction with nothing to measure (`found` 0) never lowers a recorded floor. The per-file entries come from the current measurement only: a recorded file the artifact no longer lists is a deleted file and its entry drops (#62); a new file is added at its current fraction |
| mutation | per file and global, the **larger** of the current and recorded fractions (cross-multiplied, the same comparison `atLeast` makes). A current fraction with nothing to measure (`total` 0) never lowers a recorded floor. The per-file entries come from the current measurement only: a recorded file the artifact no longer lists is a deleted file and its entry drops (#62); a new file is added at its current fraction |
| lint / typecheck | the **smaller** of the current and recorded counts (a count is a ceiling) |
| a recorded gate whose artifact is absent | **kept**, never dropped — dropping it would fall back to the greenfield wall, which is stricter, not a raise |
| a gate with no recorded floor | the current level |

So a repo that already has a baseline is unchanged by an apply that re-raises: the recorded floor
holds, and only a gate with no floor yet is raised to its measured level. A repo sitting below its
recorded floor stays red — `--raise` does not lower the floor to make it green. The floor never
rises on its own: the apply writes it once, and only `--raise` (or the improvement skill) raises it
afterwards.

`score.mjs` is importable: `main()` runs only when the file is executed directly
(`pathToFileURL(process.argv[1]) === import.meta.url`), so `import { measure } from "./score.mjs"`
does not run the score view.

## What it does not do

- No gate is run, no package manager, no network. The artifacts must already exist.
- No fallow baseline is written — fallow's floors live in fallow's own files.
- No history or trend: the committed floor is the whole state.
