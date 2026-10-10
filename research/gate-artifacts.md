# The gate artifacts and their levels

Ticket: [Gott50/code-quality-skills#61](https://github.com/Gott50/code-quality-skills/issues/61) · Branch `research/gate-artifacts` · 2026-10-10

For each gate the skill installs, this note names the artifact that carries the gate's **level**, its exact shape, and the cheapest read. It feeds [#62 (the ratchet's semantics and the baseline schema)](https://github.com/Gott50/code-quality-skills/issues/62) and [#65 (the score view: `scripts/score.mjs`)](https://github.com/Gott50/code-quality-skills/issues/65).

Every shape below was confirmed **empirically** by running the pinned tool in a throwaway `/tmp` project, except where a claim is marked *doc-sourced* or *source-sourced*. The pinned versions are the ones in `skills/code-quality-setup/templates/*/package.json`; the version each probe ran is stated per gate.

## Summary

| Gate | Artifact path | Level field | Cheapest read |
|---|---|---|---|
| bun coverage | `coverage/lcov.info` | per file `LH/LF` (lines) and `FNH/FNF` (functions); **no global record** | parse the file; sum `LF/LH/FNF/FNH` for the global (what `coverage-gate.ts` does) |
| vitest coverage | `coverage/coverage-final.json` | per file `s`/`f`/`b` hit maps; **no global record** | `JSON.parse`; sum `s`/`f`/`b` for the global |
| Stryker mutation | `reports/mutation/report.json` | `files[path].mutants[].status`; **no score field** | `JSON.parse`; count statuses (what `mutation-gate.ts` does) |
| oxlint lint | stdout of `oxlint --format json` | `diagnostics[]` (count = `diagnostics.length`) | `oxlint --format json` → `JSON.parse` → `.diagnostics.length` |
| tsc typecheck | stdout of `tsc --noEmit` | one line per error, `file(l,c): error TSxxxx: …`; **no JSON** | `tsc --noEmit --pretty false`; count lines matching `: error TS`; exit code non-zero |
| fallow health | stdout of `fallow health --format json --report-only` | `health_score.score` (0–100) + `health_score.grade` | `fallow health --format json --report-only` → `JSON.parse` → `.health_score.score` |
| fallow dead code | stdout of `fallow dead-code --format json` | `total_issues` (also `summary.total_issues`) | `fallow dead-code --format json` → `JSON.parse` → `.total_issues` |
| fallow audit (the installed gate) | stdout of `fallow audit --format json` | `verdict` (`pass`/`fail`) + `summary.dead_code_issues` | `fallow audit --format json` → `JSON.parse` → `.verdict` |

Two cross-cutting facts:

- **No gate writes a single "score" number to disk except fallow.** bun lcov, Istanbul `coverage-final.json`, and Stryker `report.json` all carry *raw per-file records*; the level is a computation over them. Only fallow's `health_score.score` is a ready-made 0–100 level.
- **Every JSON artifact is written to a path the recipe already fixes**, and every one is gitignored by the recipe's `.gitignore` block (`coverage/`, `reports/`). A score view must run the gate first, then read the artifact.

---

## 1. bun coverage — `coverage/lcov.info`

**Pinned:** no version pin (the recipe uses the project's `bun`; probed on **bun 1.4.2**). **Command:** `bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage` (the recipe's `test` script).

**Shape (empirical).** LCOV text, one `SF:`-delimited record per source file, terminated by `end_of_record`:

```
TN:
SF:src/branch.ts
FNF:1
FNH:1
DA:1,12
DA:2,27
DA:3,0
LF:3
LH:2
end_of_record
```

Per file it carries exactly:

- `SF:` — source path (relative to the run cwd).
- `FNF:` / `FNH:` — functions found / functions hit (counts only).
- `LF:` / `LH:` — lines found / lines hit.
- `DA:<line>,<hits>` — one per instrumented line.
- `TN:` (empty test name) and `end_of_record`.

**What it does *not* carry (empirical, load-bearing):**

- **No branch records.** A file with an `if`/`else` produced no `BRF`/`BRH`/`BRDA` lines — `grep -cE '^(BRF|BRH|BRDA):'` returned 0. bun's lcov has no branch coverage at all.
- **No function records.** No `FN:`/`FNDA:` lines — only the `FNF`/`FNH` counts. This is why `templates/fallow-audit/scripts/lcov-to-istanbul.ts` has to scan each source file for function declarations to rebuild the function map (the recipe says so explicitly).
- **No global record.** There is no `TN`-level or file-level summary; the global figure is the sum of `LF/LH/FNF/FNH` across all records. `coverage-gate.ts` computes exactly this (`tL*`/`tF*` accumulators) and prints `lines X% (LH/LF) | funcs Y% (FNH/FNF) across N files`.

**Cheapest read.** Parse the text (the gate already does). For a score view, the per-file level is `LH/LF` and `FNH/FNF`; the global is the sum. There is no JSON alternative — bun's other reporter is `text`.

**Source:** `skills/code-quality-setup/templates/bun-test-coverage/scripts/coverage-gate.ts` (the parser); `skills/code-quality-setup/references/recipes/bun-test-coverage.md` (the command and the "bun's own `coverageThreshold` is global" rationale).

---

## 2. vitest coverage — `coverage/coverage-final.json`

**Pinned:** `vitest` `^5.0.3`, `@vitest/coverage-istanbul` `^5.0.3` (probed on **5.0.3**). **Command:** `vitest run --coverage` with `coverage.provider: "istanbul"` and `coverage.reporter: ["text", "json"]` (the recipe's `vitest.config.ts`).

**Shape (empirical).** A single JSON object keyed by **absolute** file path; each value is an Istanbul `FileCoverage`:

```json
{
  "/private/tmp/ga-vitest/src/math.ts": {
    "path": "/private/tmp/ga-vitest/src/math.ts",
    "statementMap": { "0": { "start": {"line":1,"column":52}, "end": {"line":1,"column":66} }, ... },
    "fnMap":        { "0": { "name": "add", "decl": {...}, "loc": {...} }, ... },
    "branchMap":    { },
    "s": { "0": 1, "1": 0 },
    "f": { "0": 1, "1": 0 },
    "b": { }
  }
}
```

Per file it carries:

- `path` — absolute path (the object key is the same string).
- `statementMap` / `fnMap` / `branchMap` — id → location (and, for functions, `name`).
- `s` / `f` / `b` — id → hit count for statements / functions / branches.

**What it does *not* carry (empirical):** **no global summary.** There is no top-level `total`/`summary` object; the global figure is the sum of the `s`/`f`/`b` maps across files. (The `text` reporter prints the summary table to stdout, but that is not machine-readable.)

**Cheapest read.** `JSON.parse` the file; per-file level = `sum(hits>0)/len(s)` etc.; global = the same over all files. This is the same shape `fallow health --coverage` consumes, which is why the vitest recipe needs no lcov→istanbul bridge.

**Source:** `skills/code-quality-setup/templates/vitest-coverage/vitest.config.ts`; `skills/code-quality-setup/references/recipes/vitest-coverage.md` ("istanbul's `json` reporter writes `coverage/coverage-final.json`, which is what `fallow-audit-npm` consumes").

---

## 3. Stryker mutation — `reports/mutation/report.json`

**Pinned:** `@stryker-mutator/core` `^10.0.0` (probed on **10.0.0**), `@hughescr/stryker-bun-runner` `^1.3.8`. **Command:** `stryker run` with `jsonReporter: { fileName: "reports/mutation/report.json" }` (the recipe's `stryker.conf.mjs`).

**Shape (empirical).** The `jsonReporter` writes the `MutationTestResult` object verbatim (`JSON.stringify(report, null, 0)` — one line, no indentation). Top-level keys observed:

```
files, schemaVersion, thresholds, testFiles, projectRoot, config, framework
```

- `schemaVersion` — `"1.0"` (the report schema's major version).
- `thresholds` — `{ break, high, low }` (the config's thresholds, echoed).
- `framework` — `{ name: "StrykerJS", version: "10.0.0", branding: {...} }`.
- `projectRoot` — absolute path.
- `config` — the resolved Stryker options (free-format).
- `testFiles` — `{ "<test path>": { tests: [...] } }`.
- `files` — `{ "<source path>": { language, source, mutants: [...] } }`.

Each mutant (`files[path].mutants[]`) carries:

```json
{
  "id": "2",
  "mutatorName": "BlockStatement",
  "replacement": "{}",
  "status": "NoCoverage",
  "static": false,
  "coveredBy": [],
  "location": { "start": {"line":2,"column":51}, "end": {"line":2,"column":68} }
}
```

`status` is the level field. Its enum (from the report schema, confirmed against a real run) is:

```
Killed | Survived | NoCoverage | CompileError | RuntimeError | Timeout | Ignored | Pending
```

Optional per-mutant fields appear only when applicable: `statusReason`, `description`, `duration`, `killedBy`, `testsCompleted`.

**What it does *not* carry (empirical + source):** **no mutation score.** There is no top-level `mutationScore` (or any score) in the report — `'mutationScore' in report` was `false`. The score is computed by consumers; Stryker's own `clear-text` reporter prints the score table to stdout, but the JSON is raw statuses. The report schema's top-level `required` is only `["schemaVersion", "thresholds", "files"]`.

**Cheapest read.** `JSON.parse`; count `files[*].mutants[*].status`. The gate's `BAD_STATUSES` is `{ NoCoverage, Survived, TimedOut }` — see the defect note below.

**Defect found while probing (report it, do not silently fix here).** The report's timeout status is **`Timeout`**, but `mutation-gate.ts`'s `BAD_STATUSES` key is **`TimedOut`**:

- The report schema enum is `Timeout` (`mutation-testing-report-schema@3.8.4`, `src/mutation-testing-report-schema.json`); `TimedOut` does not appear anywhere in it.
- Stryker core maps its internal `MutantRunStatus.Timeout` to the report status string `'Timeout'` (`@stryker-mutator/core@10.0.0`, `src/reporters/mutation-test-report-helper.ts:149`).
- The bun runner's own status enum is `"timeout"` (`@hughescr/stryker-bun-runner@1.3.8`, `dist/index.js:4654`), which Stryker normalises to `Timeout`.

So `Object.hasOwn(BAD_STATUSES, "Timeout")` is `false` and a timed-out mutant is **not** counted by the gate — the gate's stated intent ("Fail on any timed-out, survived, or no-coverage mutant") is not met for timeouts. This is a one-character-class bug in `skills/code-quality-setup/templates/stryker-mutation/scripts/mutation-gate.ts` (line 31), independent of the artifact shape. It belongs to a fix ticket, not to this research note.

**Source:** `@stryker-mutator/core@10.0.0` `src/reporters/json-reporter.ts` (writes `schema.MutationTestResult` verbatim); `mutation-testing-report-schema@3.8.4` `src/mutation-testing-report-schema.json` (the enum); `skills/code-quality-setup/templates/stryker-mutation/scripts/mutation-gate.ts` (the parser).

---

## 4. oxlint lint — stdout of `oxlint --format json`

**Pinned:** `oxlint` `^1.87.0` (probed on **1.87.0**). **Command:** `oxlint --format json` (alias `-f json`; the recipe's `lint` script is bare `oxlint`, so a score view must add the flag).

**Shape (empirical).** A single JSON object on stdout:

```json
{
  "diagnostics": [
    {
      "message": "`debugger` statement is not allowed",
      "code": "eslint(no-debugger)",
      "severity": "error",
      "url": "https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-debugger.html",
      "help": "Remove the debugger statement",
      "filename": "b.ts",
      "labels": [ { "span": { "offset": 44, "length": 9, "line": 3, "column": 3 } } ]
    }
  ],
  "number_of_files": 1,
  "number_of_rules": 96,
  "threads_count": 10,
  "start_time": 0.027695708
}
```

- **The violation count is `diagnostics.length`** — there is no explicit count field. `number_of_files` and `number_of_rules` are not counts of violations.
- Each diagnostic carries `severity` (`"warning"` or `"error"`), `code` (e.g. `eslint(no-debugger)`), `filename`, and `labels[].span` (`offset`, `length`, `line`, `column`).
- The output is a single object (not JSONL) and parses with a plain `JSON.parse`.

**Exit code (empirical):** `0` when only warnings, `1` when any error-severity diagnostic. The recipe's config sets its rules to `"error"`, so a violation fails the gate. `--format` also accepts `checkstyle`, `default`, `agent`, `github`, `gitlab`, `junit`, `sarif`, `stylish`, `unix`; `json` is the machine-readable one.

**Cheapest read.** `oxlint --format json` → `JSON.parse` → `.diagnostics.length` (or filter `.severity === "error"`). No artifact file is written; the level lives on stdout.

**Source:** `oxlint --help` (the `--format` value list); `skills/code-quality-setup/templates/oxlint-anti-slop/package.json` (the pin) and `oxlint.config.ts` (rules set to `"error"`).

---

## 5. tsc typecheck — stdout of `tsc --noEmit`

**Pinned:** `typescript` `^5.6.0` (probed on **5.6.3**). **Command:** `tsc --noEmit` (the recipe's `typecheck` script).

**Shape (empirical).** Plain text, one line per diagnostic:

```
a.ts(1,40): error TS2322: Type 'number' is not assignable to type 'string'.
a.ts(2,7): error TS2322: Type 'number' is not assignable to type 'string'.
```

`--pretty false` produces the same stable one-line-per-error form (the default `--pretty` may colour/format it when stdout is a TTY). There is **no JSON reporter** — `tsc --help` lists no `--json`/`--format`; the only machine-ish flags are `--pretty`, `--listFiles`, `--diagnostics`/`--extendedDiagnostics` (timing, not error counts).

**Exit code (empirical + source):** `0` on success; **`2`** on type errors, config errors, and "no inputs" alike. TypeScript's `ExitStatus` enum is `Success = 0`, `DiagnosticsPresent_OutputsSkipped = 1`, `DiagnosticsPresent_OutputsGenerated = 2`, `InvalidProject_OutputsSkipped = 3`, `ProjectReferenceCycle_OutputsSkipped = 4`; `emitFilesAndReportErrorsAndGetExitStatus` returns `2` when diagnostics exist and emit was not skipped (`typescript@5.6.3`, `lib/tsc.js:126569`). So **non-zero = errors** is the reliable read; the exact code is not a count.

**Cheapest read.** Run `tsc --noEmit --pretty false`, capture stdout, and count lines matching `: error TS` (or `: error TS\d+`). The exit code alone tells you *whether* there are errors, not *how many*. There is no artifact file.

**Source:** `typescript@5.6.3` `lib/tsc.js` (`ExitStatus` and `emitFilesAndReportErrorsAndGetExitStatus`); `tsc --help`; `skills/code-quality-setup/templates/tsconfig-strict/package.json` (the pin and the `typecheck` script).

---

## 6. fallow — `health`, `dead-code`, and the installed `audit` gate

**Pinned:** `fallow` **`3.19.0`** (exact pin in `templates/fallow-audit/package.json`; probed on 3.19.0). All three subcommands write JSON to **stdout**; progress/warning lines go to **stderr** (so `2>/dev/null` is safe and the stdout is a single parseable object).

### 6a. `fallow health --format json --report-only` — the health level

Top-level keys (empirical): `kind`, `schema_version` (`11`), `version` (`"3.19.0"`), `elapsed_ms`, `findings`, `summary`, `vital_signs`, `health_score`, `file_scores`, `targets`, `target_thresholds`, `_meta`.

- **`health_score`** — the level: `{ formula_version: 2, score: 70.0, grade: "B", penalties: { dead_files, dead_exports, complexity, p90_complexity, maintainability, hotspots, unused_deps, circular_deps, unit_size, coupling, duplication } }`. `score` is 0–100; `grade` is the letter band.
- **`summary`** — `files_analyzed`, `functions_analyzed`, `functions_above_threshold`, `max_cyclomatic_threshold`, `max_cognitive_threshold`, `max_crap_threshold`, `max_unit_size_threshold`, `files_scored`, `average_maintainability`, `coverage_model` (`"static_estimated"` or measured), `severity_critical_count`, `severity_high_count`, `severity_moderate_count`.
- **`vital_signs`** — `dead_file_pct`, `dead_export_pct`, `avg_cyclomatic`, `critical_complexity_pct`, `p90_cyclomatic`, `duplication_pct`, `hotspot_count`, `maintainability_avg`, `maintainability_low_pct`, `unused_dep_count`, `circular_dep_count`, `counts` (`{ total_files, total_exports, dead_files, dead_exports, duplicated_lines, total_lines, files_scored, total_deps }`), `unit_size_profile`, `p95_fan_in`, `coupling_high_pct`, `total_loc`, …
- **`file_scores[]`** — per file: `path`, `fan_in`, `fan_out`, `dead_code_ratio`, `complexity_density`, `maintainability_index`, `total_cyclomatic`, `total_cognitive`, `function_count`, `lines`, `crap_max`, `crap_above_threshold`.
- **`findings[]`** — the complexity/health findings (empty when none).

**Exit code (empirical):** `--report-only` forces `0`; without it the exit is finding-driven (a run with no error-severity findings also exited `0`). Use `--report-only` for a read-only score view.

**Cheapest read.** `fallow health --format json --report-only` → `JSON.parse` → `.health_score.score` (and `.health_score.grade`). This is the only gate with a ready-made level.

### 6b. `fallow dead-code --format json` — the dead-code count

Top-level keys (empirical): `kind` (`"dead-code"`), `schema_version` (`9`), `version`, `elapsed_ms`, **`total_issues`**, `entry_points`, `summary`, then one array per issue class (`unused_files`, `unused_exports`, `unused_types`, `unused_dependencies`, `unresolved_imports`, `unlisted_dependencies`, `duplicate_exports`, `circular_dependencies`, `boundary_violations`, `policy_violations`, `stale_suppressions`, …), plus `next_steps` and `_meta`.

- **`total_issues`** is the level (also mirrored at `summary.total_issues`).
- Each issue array element carries `path` and an `actions[]` list (e.g. `{ type: "remove-export", auto_fixable: true, description: … }`); `unused_exports` elements also carry `export_name`, `line`, `col`, `is_type_only`.

**Exit code (empirical):** `1` when issues exist, `0` when clean.

**Cheapest read.** `fallow dead-code --format json` → `JSON.parse` → `.total_issues`.

### 6c. `fallow audit --format json` — the gate the skill actually installs

The recipe's gate is `fallow:audit` = `fallow audit --format json --quiet --explain --gate-marker agent` (with `.fallowrc.json` `audit.gate: "new-only"`), not `dead-code`. Its JSON (empirical) has top-level keys `kind` (`"audit"`), `schema_version` (`10`), `version`, `command`, **`verdict`** (`"pass"`/`"fail"`), `changed_files_count`, `base_ref`, `base_description`, `head_sha`, `elapsed_ms`, `summary`, `attribution`, `dead_code`, `duplication`, `complexity`, `_meta`.

- **`verdict`** is the level (`pass`/`fail`).
- **`summary`** — `{ dead_code_issues, dead_code_has_errors, complexity_findings, max_cyclomatic, duplication_clone_groups }`.
- **`attribution`** — `{ gate, dead_code_introduced, dead_code_inherited, complexity_introduced, complexity_inherited, duplication_introduced, duplication_inherited, styling_introduced, styling_inherited, duplication_demoted }` — the new-vs-inherited split that `gate: "new-only"` keys on.
- `dead_code` is the full `dead-code` report (6b) nested; `complexity` carries `findings`, `summary`, `vital_signs`.

**Exit code (empirical):** `0` on `verdict: "pass"`; `2` when it cannot detect a base branch (needs a git repo with a base ref — `--base <ref>` overrides). The gate fails on newly-introduced issues only.

**Cheapest read.** `fallow audit --format json` → `JSON.parse` → `.verdict` (and `.summary.dead_code_issues` for the count).

**Source:** `skills/code-quality-setup/templates/fallow-audit/package.json` (the pin and the three scripts); `skills/code-quality-setup/templates/fallow-audit/.fallowrc.json` (`audit.gate: "new-only"`); `skills/code-quality-setup/references/recipes/fallow-audit.md` ("`fallow:audit` is the gate; `fallow` (health) is a report, not a gate").

---

## Notes for the score view (#65) and the baseline schema (#62)

- **Levels are heterogeneous.** fallow health is a 0–100 score; the other five are counts or ratios that the score view must normalise. The baseline schema (#62) should store the *raw* per-gate level (counts/ratios), not a pre-normalised score, so the normalisation can change without re-running the gates.
- **Three gates have no artifact file** (oxlint, tsc, fallow) — their level is on stdout. A score view must capture stdout, not read a path. The three that do write files (bun lcov, vitest istanbul, Stryker) write to `coverage/` and `reports/`, both gitignored.
- **The Stryker report has no score** — the score view must compute it from `status` counts, and must use the schema's `Timeout` (not `TimedOut`).
- **bun lcov and Istanbul `coverage-final.json` have no global record** — the global is a sum the reader performs. The two formats are not interchangeable: lcov has no branch data and no function records; Istanbul has both.

## Sources

- Repo: `skills/code-quality-setup/templates/{bun-test-coverage,stryker-mutation,oxlint-anti-slop,tsconfig-strict,fallow-audit,vitest-coverage}/` (pins, configs, gate scripts) and `skills/code-quality-setup/references/recipes/*.md`.
- `@stryker-mutator/core@10.0.0` — `src/reporters/json-reporter.ts`, `src/reporters/mutation-test-report-helper.ts`.
- `mutation-testing-report-schema@3.8.4` — `src/mutation-testing-report-schema.json`.
- `@hughescr/stryker-bun-runner@1.3.8` — `dist/index.js`.
- `typescript@5.6.3` — `lib/tsc.js` (`ExitStatus`, `emitFilesAndReportErrorsAndGetExitStatus`).
- Empirical probes (2026-10-10, throwaway `/tmp` projects): bun 1.4.2, vitest 5.0.3 + @vitest/coverage-istanbul 5.0.3, @stryker-mutator/core 10.0.0 + @hughescr/stryker-bun-runner 1.3.8, oxlint 1.87.0, typescript 5.6.3, fallow 3.19.0.
