# fallow 3.19.0 baseline semantics

Branch `research/fallow-baseline` · 2026-10-10 · feeds [#62 (the ratchet's semantics and the baseline schema)](https://github.com/Gott50/code-quality-skills/issues/62)

**Version probed: `fallow 3.19.0`** (`npx --yes fallow@3.19.0`, self-reported `fallow 3.19.0` / `verified: yes … signed`). This is the version pinned in `skills/code-quality-setup/templates/*/package.json`; the latest release is 3.33.1, so every claim below is version-specific.

Every claim was confirmed **empirically** by running the pinned binary against a throwaway project in `/tmp` with real findings (a complex function, dead code, a duplicate block). Nothing here is doc-sourced unless marked. The probe project:

```
/tmp/fallow-probe
├── package.json          { "type": "module", "main": "src/index.ts" }
├── tsconfig.json
└── src/
    ├── index.ts          imports complexFn + usedHelper (the only entry point)
    ├── complex.ts        complexFn — cyclomatic 12, cognitive 21, CRAP 156 (CRITICAL)
    ├── helpers.ts        usedHelper (used) + deadHelper (unused export)
    ├── deadfile.ts       neverImported (unused file)
    ├── dupes-a.ts        processAlpha (duplicate block)
    └── dupes-b.ts        processBeta  (duplicate block)
```

`fallow health` on it (no baseline) exits **1** with `1 above threshold · 7 analyzed`; `fallow dead-code --format json` exits **1** with `total_issues: 4` (3 unused files + 1 unused export).

---

## Summary

| Question | Answer (3.19.0) |
|---|---|
| `--save-baseline` format | JSON: `finding_counts` (file → category → `{count}`) + `runtime_coverage_findings: []` + `target_keys: []`. **No version field, no score.** |
| `--baseline` comparison | Per **file + category** (`count`, default) or per **function identity** (`identity`). Not a score comparison. |
| `--baseline-mode count\|identity` | `count` = per file+category counts; `identity` = per `path\0functionName`+category. Identity baselines add an `identity_finding_counts` key. |
| New finding | exit **1**; the JSON `findings[]` holds **only the new** findings. |
| Fixed finding | exit **0**; the entry becomes `stale_entries`. |
| New file (complexity) | exit **1** (new finding). New file with only dead code → exit **0** (health baseline does not track dead code). |
| Deleted file | exit **0**; its entries become `stale_entries`. |
| `--baseline` alone | exit **0** when nothing new, **1** when something new — **including complexity findings**. |
| `--baseline` + `--coverage` | Works. `coverage_model: istanbul`; coverage changes CRAP, so a `crap_critical` entry can appear/disappear. |
| `--baseline` + `--format json` | Works. `findings[]` = new only; `summary.baseline_staleness` present. |
| `--fail-on-stale-baseline` / `--fail-on-baseline-growth` | **Do not exist** in 3.19.0 (exit 2, "unexpected argument"). |
| `fallow dead-code --format json` baseline-able count | `total_issues` (top-level) and `summary.total_issues`; per-category arrays. `dead-code` has its **own** baseline format. |

---

## 1. `fallow health --save-baseline <file>` — the exact format

```
$ npx --yes fallow@3.19.0 health --save-baseline .fallow/health-baseline.json
Saved health baseline to .fallow/health-baseline.json
… (the normal health report) …
EXIT=1
```

The saved file, verbatim:

```json
{
  "finding_counts": {
    "src/complex.ts": {
      "complexity_critical": {
        "count": 1
      },
      "crap_critical": {
        "count": 1
      }
    }
  },
  "runtime_coverage_findings": [],
  "target_keys": []
}
```

Shape notes (all empirical):

- **No version field, no timestamp, no score.** The file is a bare finding inventory. The health *score* is not baselined at all — it is a separate concept (`--min-score`).
- `finding_counts` is keyed by **file path** → **category** → `{ "count": N }`. The two categories observed for a complex function are `complexity_critical` and `crap_critical` (one entry each, because the function breached both the cognitive threshold and the CRAP threshold). A function that breaches only one dimension would produce only that category.
- `runtime_coverage_findings` and `target_keys` are arrays; both stayed `[]` in every probe (including with `--targets` and with `--coverage`). They are reserved for `--runtime-coverage` findings and refactoring-target keys respectively.
- Saving exits with the **normal health exit code** (1 here, because findings exist) — `--save-baseline` does not suppress the gate.

### 1a. `--baseline-mode identity` adds a second key

```
$ npx --yes fallow@3.19.0 health --save-baseline .fallow/health-baseline-identity.json --baseline-mode identity
```

```json
{
  "finding_counts": {
    "src/complex.ts": {
      "complexity_critical": { "count": 1 },
      "crap_critical": { "count": 1 }
    }
  },
  "identity_finding_counts": {
    "src/complex.ts\u0000complexFn": {
      "complexity_critical": { "count": 1 },
      "crap_critical": { "count": 1 }
    }
  },
  "runtime_coverage_findings": [],
  "target_keys": []
}
```

The identity key is `"<path>\u0000<functionName>"` — a literal **NUL byte** (`\u0000`) between path and name. An identity baseline keeps `finding_counts` too, so it still reads in count mode.

---

## 2. `fallow health --baseline <file>` — how it compares

`--baseline` compares the current run's findings against the saved inventory. It is **not** a score comparison and **not** a count-only comparison — it is per file + category (count mode) or per function identity + category (identity mode).

The JSON output changes in two ways:

1. `findings[]` contains **only the new (unmatched) findings** — baselined findings are filtered out.
2. `summary.baseline_staleness` is added:

```json
"baseline_staleness": {
  "baseline_entries": 2,
  "matched_entries": 2,
  "stale_entries": 0,
  "moved_entries": 0,
  "change_scoped": false,
  "stale": false
}
```

- `baseline_entries` — total entries in the baseline file.
- `matched_entries` — entries still present in the current run.
- `stale_entries` — entries no longer present (fixed, deleted, or renamed).
- `moved_entries` — entries whose file moved (0 in every probe; no move was exercised).
- `change_scoped` — whether the run was scoped by `--changed-since`/`--diff-file` (false in every probe).
- `stale` — see §4.

### 2a. `--baseline-mode count` vs `identity`

| | `count` (default) | `identity` |
|---|---|---|
| Match key | file path + category | `path\0functionName` + category |
| Rename a function | **invisible** (same file, same category) → exit 0 | **new finding** → exit 1 |
| Add a 2nd complex fn to a file that already had 1 | count 1→2 exceeds the baseline → **both** functions reported new → exit 1 | only the **new** function reported → exit 1 |
| Baseline file needed | any | must have been saved with `--baseline-mode identity` |

The count-increase case is the sharpest difference. With the count baseline (`src/complex.ts` had `complexity_critical: 1`), appending a second complex function to the same file produced:

```
count mode:    new findings = [complexFn, secondComplex]   exit 1
identity mode: new findings = [secondComplex]              exit 1
```

So count mode flags the whole file+category when the count grows; identity mode flags only the genuinely new function.

**Mode downgrade / overwrite guard (empirical):**

- `--baseline-mode count` on an identity baseline → **works** (exit 0); the identity key is simply ignored.
- `--save-baseline` **without** a mode over an identity baseline → **refuses**, exit **2**:
  ```
  Error: refusing to overwrite health baseline .fallow/health-baseline-identity.json: it carries
  per-function identities (saved with --baseline-mode identity), and this count-mode save would
  drop them, breaking later --baseline-mode identity runs. Re-save with --baseline-mode identity
  to keep them, or pass --baseline-mode count explicitly to downgrade the baseline
  ```
- `--save-baseline --baseline-mode count` over an identity baseline → **downgrades** (drops `identity_finding_counts`), exit 1.

---

## 3. New / fixed / new file / deleted file — the full matrix

All rows use the count baseline unless noted. `new` = length of the JSON `findings[]`.

| Scenario | exit | new | matched | stale | `stale` flag |
|---|---|---|---|---|---|
| no change | 0 | 0 | 2 | 0 | false |
| new complexity fn in a **new** file | 1 | 1 | 2 | 0 | false |
| new complexity fn in an **existing** file | 1 | 1 | 2 | 0 | false |
| **fixed** finding (simplify `complexFn`) | 0 | 0 | 0 | 2 | false |
| **deleted** file (`rm src/complex.ts`) | 0 | 0 | 0 | 2 | false |
| new file with **only dead code** | 0 | 0 | 2 | 0 | false |
| count increase in same file+category (1→2) | 1 | 2 | 2 | 0 | false |
| **rename** `complexFn`→`renamedFn` (identity mode) | 1 | 1 | 0 | 2 | **true** |
| rename `complexFn`→`renamedFn` (count mode) | 0 | 0 | 2 | 0 | false |
| fix `complexFn` **and** add a new complex file | 1 | 1 | 0 | 2 | **true** |
| `--coverage` makes `crap_critical` disappear (fn now covered) | 0 | 0 | 1 | 1 | **true** |

Load-bearing observations:

- **The health baseline tracks complexity/CRAP findings only.** A brand-new file whose only problem is dead code exits **0** — dead code is not in `finding_counts`. (Dead code has its own baseline; see §7.)
- **Fixing or deleting is never a failure.** Both exit 0; the entries simply become `stale_entries`.
- **A new file is not special** — it fails only if it introduces a complexity/CRAP finding.
- **Coverage changes the category set.** With `--coverage` marking `complexFn` as covered, its CRAP drops below threshold, so `crap_critical` no longer matches → `matched 1, stale 1`. The baseline matches by **category presence**, not by score value: an uncovered run (CRAP still high) matched both entries.

---

## 4. What `stale: true` means

`stale` is **not** simply `stale_entries > 0`. Across all 11 data points above, the flag is consistent with:

```
stale = (stale_entries > 0) AND (matched_entries > 0 OR new_findings > 0)
```

i.e. the baseline is "stale" when it is **partly out of date but still in play** — some entries still match, or new findings appeared alongside the stale ones. When *every* entry is stale and nothing new appeared (a pure fix or a pure deletion), the baseline is simply obsolete, not stale, and the flag is `false`.

This is an **inferred** rule (it fits every observed row); the exact predicate is not documented in 3.19.0. In 3.19.0 the flag is **reported only** — it does not affect the exit code. (`--fail-on-stale-baseline`, which would gate on it, is 3.33.1-only; see §6.)

---

## 5. Exit codes and flag interactions

`--baseline` alone is the ratchet: **exit 0 when nothing new, exit 1 when something new — including complexity findings.**

```
$ npx --yes fallow@3.19.0 health --baseline .fallow/health-baseline.json   # no change
EXIT=0
$ npx --yes fallow@3.19.0 health --baseline .fallow/health-baseline.json   # new complex file added
EXIT=1
```

With a new finding present, the other gate flags behave as follows:

| Invocation (new finding present) | exit |
|---|---|
| `--baseline` alone | 1 |
| `--baseline --fail-on-issues` | 1 |
| `--baseline --min-severity critical` | 1 |
| `--baseline --min-score 0` | **0** |
| `--baseline --min-score 99` | 1 |
| `--baseline --report-only` | **0** |

- **`--min-score` replaces the finding-driven exit.** `--min-score 0` forces exit 0 even with a new finding — the same trap recorded on the map: `--min-score` and `--baseline` must never share one invocation. `--min-score 99` fails on the score alone.
- `--report-only` always exits 0 (advisory).
- `--fail-on-issues` and `--min-severity` compose with `--baseline` and still fail on the new finding.

### 5a. Combinations

- **`--baseline` + `--coverage`** — works. `summary.coverage_model` becomes `istanbul` (vs `static_estimated` without). The baseline still matches per file+category; coverage only shifts which categories are present.
- **`--baseline` + `--format json`** — works. `findings[]` = new only; `summary.baseline_staleness` present.
- **`--baseline` + `--format sarif`** — works (exit 0 with no new findings; valid SARIF 2.1.0 emitted).

### 5b. Error handling

| Case | exit | message |
|---|---|---|
| baseline file missing | 2 | `Error: failed to read health baseline: No such file or directory (os error 2)` |
| baseline file malformed | 2 | `Error: failed to parse health baseline: expected ident at line 1 column 2` |
| save over identity baseline without a mode | 2 | `Error: refusing to overwrite health baseline …` (see §2a) |

---

## 6. `--fail-on-stale-baseline` / `--fail-on-baseline-growth`

**Neither exists in 3.19.0.** Both are rejected as unknown arguments (exit **2**):

```
$ npx --yes fallow@3.19.0 health --fail-on-stale-baseline
error: unexpected argument '--fail-on-stale-baseline' found
  tip: a similar argument exists: '--fail-on-regression'
EXIT=2

$ npx --yes fallow@3.19.0 health --fail-on-baseline-growth
error: unexpected argument '--fail-on-baseline-growth' found
  tip: a similar argument exists: '--fail-on-regression'
EXIT=2
```

Confirmed: these are 3.33.1-only. The 3.19.0 primitives that *do* exist are `--baseline`, `--baseline-mode`, `--save-baseline`, `--fail-on-regression`, `--tolerance`, `--regression-baseline`, `--save-regression-baseline`, `--min-score`, `--min-severity`, `--report-only`.

---

## 7. `fallow dead-code --format json` — the baseline-able count

`fallow dead-code --format json` reports the count at **`total_issues`** (top level) and **`summary.total_issues`** (identical), plus a per-category breakdown in `summary` (`unused_files`, `unused_exports`, `unused_types`, …) and the finding arrays themselves (`unused_files[]`, `unused_exports[]`, …). On the probe project: `total_issues: 4` (3 unused files + 1 unused export), exit 1.

`dead-code` has its **own** baseline, with a **different format** from health:

```
$ npx --yes fallow@3.19.0 dead-code --save-baseline .fallow/deadcode-baseline.json
```

```json
{
  "analysis_identity": {
    "mode": "syntactic",
    "semantic_schema_version": 1,
    "capabilities": [],
    "project_config_hash": "",
    "backend_family": "",
    "completeness": "complete"
  },
  "unused_files": [
    "src/deadfile.ts",
    "src/dupes-a.ts",
    "src/dupes-b.ts"
  ],
  "unused_exports": [
    "src/helpers.ts:deadHelper"
  ],
  "unused_types": [],
  "private_type_leaks": [],
  "unused_dependencies": [],
  "unused_dev_dependencies": [],
  "circular_dependencies": [],
  "re_export_cycles": [],
  "unused_optional_dependencies": [],
  "unused_enum_members": [],
  "unused_class_members": [],
  "unused_store_members": [],
  "unprovided_injects": [],
  "unrendered_components": [],
  "unused_component_props": [],
  "unused_component_emits": [],
  "unused_component_inputs": [],
  "unused_component_outputs": [],
  "unused_svelte_events": [],
  "unused_server_actions": [],
  "unused_load_data_keys": [],
  "unresolved_imports": [],
  "unlisted_dependencies": [],
  "duplicate_exports": [],
  "type_only_dependencies": [],
  "test_only_dependencies": [],
  "dev_dependencies_in_production": [],
  "boundary_violations": [],
  "boundary_coverage_violations": [],
  "boundary_call_violations": [],
  "policy_violations": [],
  "stale_suppressions": [],
  "unused_catalog_entries": [],
  "empty_catalog_groups": [],
  "unresolved_catalog_references": [],
  "unused_dependency_overrides": [],
  "misconfigured_dependency_overrides": [],
  "invalid_client_exports": [],
  "mixed_client_server_barrels": [],
  "misplaced_directives": [],
  "route_collisions": [],
  "dynamic_segment_name_conflicts": []
}
```

- **Per-identity, not per-count.** `unused_files` holds file paths; `unused_exports` holds `"<path>:<exportName>"` strings. One array per category.
- `analysis_identity` records the analysis mode (`syntactic`), a schema version, capabilities, a config hash, and completeness — so a baseline saved under a different analysis mode can be detected.
- With `--baseline`, the JSON output gains a top-level **`baseline`** key and `total_issues`/`summary.total_issues` reflect **only the new** issues:

  ```
  no change:        exit 0
  new dead file:    exit 1, total_issues: 1, baseline: { "entries": 4, "matched": 4 }
  fixed finding:    exit 0, total_issues: 0, baseline: { "entries": 4, "matched": 3 }
  ```

  So the dead-code baseline reports `{ entries, matched }` (no `stale`/`moved` fields), and the count is the **new** count, not the total.

---

## 8. Other commands (for completeness)

- **`fallow dupes`** also has `--baseline` / `--save-baseline`, with a third format:
  ```json
  {
    "clone_groups": ["src/dupes-a.ts:1-11|src/dupes-b.ts:1-11"],
    "clone_fingerprints": ["dup:71128a7b:2"],
    "normalized_clone_fingerprints": ["dup:6f87acd9:2"]
  }
  ```
- **`fallow audit` rejects the global `--baseline`/`--save-baseline`** (exit 2):
  ```
  Error: audit uses per-analysis baselines. Use --dead-code-baseline, --health-baseline, or
  --dupes-baseline (or save them with `fallow dead-code|health|dupes --save-baseline <file>`)
  ```
  `audit` requires the per-analysis flags `--dead-code-baseline`, `--health-baseline`, `--dupes-baseline` because each sub-analysis uses a different baseline format.

---

## 9. Consequences for the ratchet design (#62)

- **The health ratchet is `--baseline` alone.** It is per-finding (file+category, or function identity), so known findings pass and new ones fail — including complexity. It is **not** a score floor; the score is a separate view (`--min-score`, or `health_score.score` from `--format json --report-only`).
- **`--min-score` and `--baseline` must never share one invocation** — `--min-score` replaces the finding-driven exit, so `--min-score 0 --baseline` lets a new complex file exit 0.
- **Three baseline formats, not one.** health (`finding_counts`), dead-code (per-category identity arrays + `analysis_identity`), dupes (`clone_groups`/fingerprints). A unified `.code-quality-baseline.json` must either embed three sections or reference three files; `audit` already forces the per-analysis split.
- **`--baseline-mode identity` is the strict ratchet** for complexity: a rename or a same-file replacement is reported as new. `count` is the loose default and hides renames.
- **Fixing/deleting never fails**; only new findings do. A ratchet that wants "the floor only rises" must re-save the baseline after an improvement (the baseline does not auto-raise).
- **`stale` is informational in 3.19.0** — gating on it needs 3.33.1's `--fail-on-stale-baseline`, which is the open "bump the fallow pin" question on the map.
