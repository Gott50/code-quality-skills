/**
 * Coverage gate — the per-file floor from the committed baseline, and (with
 * `--changed-lines <ref>` / `$CODE_QUALITY_BASE_REF`) the coverage of the lines
 * a change touches.
 *
 * Reads bun's lcov output and `.code-quality-baseline.json` (written by the
 * skill's `score.mjs --raise`) and fails listing every file below its floor on
 * either line or function coverage. The floor for a file the baseline records is
 * its exact `{hit, found}` fraction per metric under `gates.coverage.files` —
 * `lines` from lcov `LH`/`LF`, `functions` from `FNH`/`FNF` — compared by
 * cross-multiplication; a file it does not record gets the
 * `gates.coverage.global` fractions. With no baseline every floor is 100%, the
 * greenfield wall.
 *
 * An artifact that is absent, or that lists no file, is a failure — the reporter
 * did not write — unless the project has no test file at all, in which case
 * there is nothing to measure and the gate exits 0.
 *
 * Usage:
 *   bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage
 *   bun scripts/coverage-gate.ts --lcov coverage/lcov.info --baseline .code-quality-baseline.json
 *   bun scripts/coverage-gate.ts --changed-lines origin/main
 *
 * Defaults: --lcov ./coverage/lcov.info, --baseline ./.code-quality-baseline.json.
 * `--changed-lines` adds the PR rule — every instrumented line the diff adds or
 * modifies must be executed — on top of the per-file floor. Exit 0 when every
 * file meets its floor and every changed line is covered; exit 1 otherwise.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkChangedLines, resolveBaseRef, TEST_FILE } from "./changed-lines.ts";

function parseArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** An exact fraction, as the baseline records it — never a rounded ratio. */
interface Frac {
  found: number;
  hit: number;
}

/** One file's coverage floor: one exact fraction per metric. */
interface CoverageFrac {
  functions: Frac;
  lines: Frac;
}

/** A fraction as the baseline JSON carries it: unchecked, so every field optional. */
interface RawFrac {
  found?: number;
  hit?: number;
}

/** A coverage floor as the baseline JSON carries it: unchecked. */
interface RawCoverageFrac {
  functions?: RawFrac;
  lines?: RawFrac;
}

/** The baseline's `gates.coverage` block (scripts/SCORE-SCHEMA.md), as parsed. */
interface CoverageFloor {
  files?: Record<string, RawCoverageFrac>;
  global?: RawCoverageFrac;
}

/** The baseline's coverage floors: `global` for unrecorded files, `files` per file. */
interface Floors {
  files: Map<string, CoverageFrac>;
  global: CoverageFrac;
}

interface Baseline {
  gates?: { coverage?: CoverageFloor };
}

/** The greenfield floor: 100% on both metrics. */
const FULL: CoverageFrac = { functions: { found: 1, hit: 1 }, lines: { found: 1, hit: 1 } };

const lcovPath = parseArg("--lcov") ?? "coverage/lcov.info";
const baselinePath = parseArg("--baseline") ?? ".code-quality-baseline.json";

// Whether the project has any test file, by bun's own discovery patterns. Only
// consulted when the artifact is absent or lists no file. Dot-directories are
// skipped: the installed skill lives in one, and its test files are not ours.
function hasTestFiles(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasTestFiles(path)) return true;
    } else if (TEST_FILE.test(entry.name)) {
      return true;
    }
  }
  return false;
}

if (!existsSync(lcovPath)) {
  // A run that found no test files writes no lcov at all — bun instruments
  // nothing, so there is nothing to measure and the gate is green. A missing
  // artifact with test files present is a real failure (the reporter did not
  // write), so the scan is deliberately conservative: any matching file counts.
  if (!hasTestFiles(process.cwd())) {
    console.log(`coverage-gate: no lcov at ${lcovPath} and no test files — nothing to measure`);
    process.exit(0);
  }
  console.error(`coverage-gate: lcov not found at ${lcovPath}`);
  console.error(
    `Run first: bun test --coverage --coverage-reporter=lcov --coverage-dir=${"coverage"}`,
  );
  process.exit(1);
}

/** Whether `v` is an exact fraction as the baseline records it. */
function isFrac(v: RawFrac | undefined): v is Frac {
  return !!v && Number.isInteger(v.hit) && Number.isInteger(v.found);
}

/** Whether `v` carries a floor for both metrics. */
function isCoverageFrac(v: RawCoverageFrac | undefined): v is CoverageFrac {
  return !!v && isFrac(v.lines) && isFrac(v.functions);
}

// The baseline as parsed, or exit 1 when the file is unreadable: a floor file
// that cannot be read must not silently become 100%. The parse is unannotated on
// purpose — `JSON.parse` returns `any`, so the block is read through the
// `Baseline` return type and every leaf is re-checked by `isCoverageFrac`; an
// `as Baseline` would assert the shape instead of checking it.
function readBaseline(path: string): Baseline {
  if (!existsSync(path)) return {};
  try {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    return { gates: { coverage: doc?.gates?.coverage } };
  } catch (err) {
    console.error(`coverage-gate: baseline ${path} is unreadable: ${err}`);
    process.exit(1);
  }
}

// The per-file floors the baseline records, keyed by absolute path. A coverage
// block that does not carry both metrics is unreadable: the floor is per
// metric, and a missing one must not silently become 100%.
function fileFloors(
  path: string,
  files: Record<string, RawCoverageFrac> | undefined,
): Map<string, CoverageFrac> {
  const floors = new Map<string, CoverageFrac>();
  for (const [key, frac] of Object.entries(files ?? {})) {
    if (!isCoverageFrac(frac)) {
      console.error(`coverage-gate: baseline ${path} records no lines/functions floor for ${key}`);
      process.exit(1);
    }
    floors.set(resolve(dirname(path), key), frac);
  }
  return floors;
}

// The baseline's coverage floors: `global` is the floor for a file the baseline
// does not record, `files` its per-file floors.
function readFloors(path: string): Floors {
  const coverage = readBaseline(path).gates?.coverage;
  const globalFloor = coverage?.global;
  if (globalFloor !== undefined && !isCoverageFrac(globalFloor)) {
    console.error(`coverage-gate: baseline ${path} records no lines/functions floor`);
    process.exit(1);
  }
  return { files: fileFloors(path, coverage?.files), global: globalFloor ?? FULL };
}

const floors = readFloors(baselinePath);

const text = readFileSync(lcovPath, "utf-8");

interface CovFile {
  fnf: number;
  fnh: number;
  lines: Map<number, number>;
  lf: number;
  lh: number;
  sf: string;
}

// lcov records may repeat an SF across multiple blocks; accumulate per file.
const byFile: Record<string, CovFile> = {};

for (const block of text.split(/(?=^SF:)/m)) {
  const lines = block.split("\n");
  const sf = lines
    .find((l) => l.startsWith("SF:"))
    ?.slice(3)
    ?.trim();
  if (!sf) continue;
  const num = (k: string) => {
    const l = lines.find((x) => x.startsWith(`${k}:`));
    return l ? Number(l.split(":")[1]) : 0;
  };
  const rec = byFile[sf] ?? { fnf: 0, fnh: 0, lines: new Map(), lf: 0, lh: 0, sf };
  rec.lf += num("LF");
  rec.lh += num("LH");
  rec.fnf += num("FNF");
  rec.fnh += num("FNH");
  // `DA:<line>,<hits>` is the per-line record the changed-lines rule needs.
  for (const l of lines) {
    if (!l.startsWith("DA:")) continue;
    const [lineNo, hits] = l.slice(3).split(",");
    const n = Number(lineNo);
    rec.lines.set(n, Math.max(rec.lines.get(n) ?? 0, Number(hits)));
  }
  byFile[sf] = rec;
}

if (Object.keys(byFile).length === 0) {
  // An lcov that lists no file measured nothing. With no test files that is the
  // empty test set — nothing to measure, and the gate is green. With test files
  // present the coverage setup produced nothing (tests that import no source, or
  // a `coveragePathIgnorePatterns` that excludes it all), which must not
  // silently pass.
  if (!hasTestFiles(process.cwd())) {
    console.log(`coverage-gate: ${lcovPath} lists no file and no test files — nothing to measure`);
    process.exit(0);
  }
  console.error(`coverage-gate: ${lcovPath} lists no file but the project has test files`);
  console.error("Check coveragePathIgnorePatterns in bunfig.toml");
  process.exit(1);
}

/** `75% (3/4)` — the floor beside the level it failed. */
function fracText(frac: Frac): string {
  return frac.found === 0
    ? "100% (nothing to measure)"
    : `${((frac.hit / frac.found) * 100).toFixed(2)}% (${frac.hit}/${frac.found})`;
}

/** `cur >= floor` on the exact fraction, cross-multiplied. */
function meets(hit: number, found: number, floor: Frac): boolean {
  return found === 0 || hit * floor.found >= floor.hit * found;
}

const failing: string[] = [];
let tLF = 0,
  tLH = 0,
  tFNF = 0,
  tFNH = 0;

for (const r of Object.values(byFile)) {
  tLF += r.lf;
  tLH += r.lh;
  tFNF += r.fnf;
  tFNH += r.fnh;
  // The lcov's `SF:` paths are relative to the cwd (a workspace member's own
  // run), the baseline's keys to the workspace root, so both are resolved to
  // an absolute path before matching.
  const floor = floors.files.get(resolve(r.sf)) ?? floors.global;
  const linePct = r.lf > 0 ? (r.lh / r.lf) * 100 : 100;
  const funcPct = r.fnf > 0 ? (r.fnh / r.fnf) * 100 : 100;
  const below: string[] = [];
  if (!meets(r.lh, r.lf, floor.lines)) {
    below.push(`lines ${linePct.toFixed(2)}%  (${r.lh}/${r.lf}) — floor ${fracText(floor.lines)}`);
  }
  if (!meets(r.fnh, r.fnf, floor.functions)) {
    below.push(
      `funcs ${funcPct.toFixed(2)}%  (${r.fnh}/${r.fnf}) — floor ${fracText(floor.functions)}`,
    );
  }
  if (below.length > 0) failing.push(`${r.sf}\n    ${below.join("\n    ")}`);
}

const totalLinePct = tLF > 0 ? (tLH / tLF) * 100 : 100;
const totalFuncPct = tFNF > 0 ? (tFNH / tFNF) * 100 : 100;
const baselineLabel = existsSync(baselinePath) ? baselinePath : "none — every floor is 100%";

console.log(
  `coverage-gate: baseline ${baselineLabel} | ` +
    `global floor lines ${fracText(floors.global.lines)} ` +
    `funcs ${fracText(floors.global.functions)} | ` +
    `lines ${totalLinePct.toFixed(2)}% (${tLH}/${tLF}) | ` +
    `funcs ${totalFuncPct.toFixed(2)}% (${tFNH}/${tFNF}) ` +
    `across ${Object.keys(byFile).length} files`,
);

const baseRef = resolveBaseRef();
const changedResult =
  baseRef === undefined ? null : checkChangedLines(baseRef, Object.values(byFile));
if (changedResult !== null) {
  console.log(
    `coverage-gate: changed-lines ${baseRef} | ${changedResult.checked} changed line(s) across ${changedResult.files} instrumented file(s)`,
  );
}

if (failing.length > 0) {
  console.error(`\n${failing.length} file(s) below their coverage floor:\n`);
  console.error(failing.join("\n\n"));
  process.exit(1);
}

if (changedResult !== null && changedResult.uncovered.length > 0) {
  console.error(`\n${changedResult.uncovered.length} file(s) with uncovered changed lines:\n`);
  console.error(changedResult.uncovered.join("\n\n"));
  process.exit(1);
}

console.log("coverage-gate: PASS — every file meets its floor");
if (baseRef !== undefined) console.log("coverage-gate: PASS — every changed line is covered");
