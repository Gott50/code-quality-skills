/**
 * Coverage gate — enforces the per-file coverage floor recorded in the
 * committed baseline. The Vitest twin of the Bun recipe's
 * `scripts/coverage-gate.ts`: the same floors, read from Istanbul's
 * `coverage/coverage-final.json` (statements and functions) instead of bun's
 * lcov.
 *
 * The floor for a file the baseline records is its exact `{hit, found}`
 * fraction per metric under `gates.coverage.files` — `statements` from the
 * `s` map, `functions` from the `f` map — compared by cross-multiplication so
 * no float rounding creeps in; a file the baseline does not record gets the
 * `gates.coverage.global` fractions. Each metric is enforced against its own
 * floor: a file at 4/10 statements and 0/1 functions passes only when both
 * floors are met. The global fraction over the whole project is `score.mjs`'s
 * comparison, not this gate's: a workspace member's own run aggregates the
 * member alone, and holding it to the workspace-wide fraction would fail a
 * member that is exactly at its recorded floor. With no baseline — or a
 * baseline whose coverage gate was never raised — every floor is 100%, the
 * greenfield wall, so a repo that never raised one is gated exactly as
 * before.
 *
 * An artifact that is absent, or that lists no file, is a failure — the
 * reporter did not write — unless the project has no test file at all, in
 * which case there is nothing to measure and the gate exits 0. That is what
 * keeps the gate green on day one in a repo with no tests (`vitest run
 * --passWithNoTests`); a missing artifact with test files present still exits 1.
 *
 * Usage (the `test` script runs it after `vitest run --coverage`):
 *   node scripts/coverage-gate.mjs --coverage coverage/coverage-final.json --baseline .code-quality-baseline.json
 *   node scripts/coverage-gate.mjs --changed-lines origin/main
 *
 * Defaults: --coverage ./coverage/coverage-final.json,
 *           --baseline ./.code-quality-baseline.json.
 * `--changed-lines <ref>` adds the PR rule: every line the diff against `<ref>`
 * adds or modifies must be executed. The per-file floor still governs the whole
 * file, so a change to an uncovered line of a grandfathered file fails the
 * changed-lines rule even though the file meets its floor. `$CODE_QUALITY_BASE_REF`
 * supplies the ref when the flag is absent, so the CI workflow sets it on the
 * test step without the `test` script carrying a flag a local run cannot resolve.
 *
 * Exit 0 when every file meets its floor and every changed line is covered;
 * exit 1 with a report otherwise.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

function parseArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// A ref is usable when it is a non-empty string: a workflow that interpolates an
// absent context (`${{ github.event.pull_request.base.sha }}` on a push) sets the
// variable to the empty string, and `git diff ""` is an error rather than a
// no-op.
function resolveBaseRef() {
  const ref = parseArg("--changed-lines") ?? process.env.CODE_QUALITY_BASE_REF;
  return ref !== undefined && ref !== "" ? ref : undefined;
}

/** The greenfield floor: 100% on both metrics. */
const FULL = { functions: { found: 1, hit: 1 }, statements: { found: 1, hit: 1 } };

const coveragePath = parseArg("--coverage") ?? "coverage/coverage-final.json";
const baselinePath = parseArg("--baseline") ?? ".code-quality-baseline.json";

/**
 * The lines a diff against `ref` adds or modifies, per file. The `git diff`
 * paths are repo-root-relative; the Istanbul keys are absolute, so both sides
 * are resolved to an absolute path before matching.
 *
 * A diff that cannot be computed is a failure, not a silent pass: a gate that
 * cannot see the change must not report it covered.
 */
function changedLines(ref) {
  let out;
  try {
    out = execFileSync("git", ["diff", "--unified=0", "--no-color", ref, "--"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    console.error(`coverage-gate: git diff against ${ref} failed: ${err}`);
    process.exit(1);
  }
  const changed = new Map();
  let file = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      file = path === "/dev/null" ? null : path.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || file === null) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = changed.get(resolve(file)) ?? new Set();
    for (let i = 0; i < count; i++) lines.add(start + i);
    changed.set(resolve(file), lines);
  }
  return changed;
}

/** Vitest's default test-file pattern: `**\/*.{test,spec}.?(c|m)[jt]s?(x)`. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

// Whether the project has any test file, by vitest's own default include. Only
// consulted when the artifact is absent or lists no file. Dot-directories are
// skipped: the installed skill itself lives in one (`.agents/skills/<name>/`),
// and a test file inside it is not the project's.
function hasTestFiles(dir) {
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

if (!existsSync(coveragePath)) {
  // Vitest writes the artifact even with no test files (every `coverage.include`
  // match is reported at 0%), so this branch is a safety net: a missing artifact
  // with no test files is nothing to measure, and the gate is green. A missing
  // artifact with test files present is a real failure (the reporter did not
  // write), so the scan is deliberately conservative: any matching file counts.
  if (!hasTestFiles(process.cwd())) {
    console.log(
      `coverage-gate: no coverage at ${coveragePath} and no test files — nothing to measure`,
    );
    process.exit(0);
  }
  console.error(`coverage-gate: coverage not found at ${coveragePath}`);
  console.error("Run first: vitest run --coverage");
  process.exit(1);
}

/** Whether `v` is an exact fraction as the baseline records it. */
function isFrac(v) {
  return !!v && Number.isInteger(v.hit) && Number.isInteger(v.found);
}

/** Whether `v` carries a floor for both metrics. */
function isCoverageFrac(v) {
  return !!v && isFrac(v.statements) && isFrac(v.functions);
}

// The baseline as parsed, or exit 1 when the file is unreadable: a floor file
// that cannot be read must not silently become 100%.
function readBaseline(path) {
  try {
    // SAFETY: the baseline is JSON written by score.mjs; only the coverage
    // gate's `global` fraction and `files` map are read.
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`coverage-gate: baseline ${path} is unreadable: ${err}`);
    process.exit(1);
  }
}

// The baseline's global floor, or exit 1 when it is malformed. A coverage
// block that does not carry both metrics is unreadable: the floor is per
// metric, and a missing one must not silently become 100%.
function readGlobalFloor(path, global) {
  if (global !== undefined && !isCoverageFrac(global)) {
    console.error(`coverage-gate: baseline ${path} records no statements/functions floor`);
    process.exit(1);
  }
  return global ?? FULL;
}

// Exit 1 when any recorded per-file floor is malformed.
function checkFileFloors(path, files) {
  for (const [key, frac] of Object.entries(files)) {
    if (!isCoverageFrac(frac)) {
      console.error(
        `coverage-gate: baseline ${path} records no statements/functions floor for ${key}`,
      );
      process.exit(1);
    }
  }
}

// The baseline's coverage block, or exit 1 when a floor is malformed.
function readCoverage(path, doc) {
  const coverage = doc?.gates?.coverage ?? {};
  const files = coverage.files ?? {};
  checkFileFloors(path, files);
  return { files, global: readGlobalFloor(path, coverage.global) };
}

// The baseline's coverage floors: `global` is the floor for a file the
// baseline does not record, `files` its per-file floors keyed as recorded
// (workspace-root-relative), and `abs` the same floors keyed by the absolute
// path each recorded key resolves to beside the baseline file — the form the
// Istanbul keys are matched in.
function readFloors(path) {
  if (!existsSync(path)) return { abs: new Map(), files: {}, global: FULL };
  const { files, global } = readCoverage(path, readBaseline(path));
  const abs = new Map(
    Object.entries(files).map(([key, frac]) => [resolve(dirname(path), key), frac]),
  );
  return { abs, files, global };
}

const floors = readFloors(baselinePath);

// The statement hit count per source line: a line is covered when at least one
// statement starting on it was hit. The changed-lines rule reads this; the
// statement and function fractions below are the per-file floor's measure.
function statementLines(map, s) {
  const lines = new Map();
  for (const [id, stmt] of Object.entries(map)) {
    const line = stmt?.start?.line;
    if (line === undefined) continue;
    lines.set(line, Math.max(lines.get(line) ?? 0, Number(s[id] ?? 0)));
  }
  return lines;
}

// Istanbul's `coverage-final.json` is keyed by absolute path; each value
// carries an `s` statement hit map and an `f` function hit map. The level is
// hit / found per map, one exact fraction per metric (SCORE-SCHEMA.md).
function readIstanbul(doc) {
  const files = {};
  for (const [key, fc] of Object.entries(doc ?? {})) {
    const s = fc?.s ?? {};
    const f = fc?.f ?? {};
    files[key] = {
      functions: {
        found: Object.keys(f).length,
        hit: Object.values(f).filter((n) => n > 0).length,
      },
      lines: statementLines(fc?.statementMap ?? {}, s),
      sf: key,
      statements: {
        found: Object.keys(s).length,
        hit: Object.values(s).filter((n) => n > 0).length,
      },
    };
  }
  return files;
}

let doc;
try {
  // SAFETY: Istanbul's json reporter writes one FileCoverage map; only the
  // `s` and `f` hit maps are read.
  doc = JSON.parse(readFileSync(coveragePath, "utf8"));
} catch (err) {
  console.error(`coverage-gate: coverage ${coveragePath} is unreadable: ${err}`);
  process.exit(1);
}
const byFile = readIstanbul(doc);

if (Object.keys(byFile).length === 0) {
  // An artifact that lists no file measured nothing. With no test files that is
  // the empty test set — nothing to measure, and the gate is green. With test
  // files present the coverage setup produced nothing (a `coverage.include`
  // that matches no file), which must not silently pass.
  if (!hasTestFiles(process.cwd())) {
    console.log(
      `coverage-gate: ${coveragePath} lists no file and no test files — nothing to measure`,
    );
    process.exit(0);
  }
  console.error(`coverage-gate: ${coveragePath} lists no file but the project has test files`);
  console.error("Check coverage.include in vitest.config.ts");
  process.exit(1);
}

/** The floor for one file: its own if the baseline records it, else global. */
function floorOf(rec) {
  // The baseline's keys are workspace-root-relative, the Istanbul keys
  // absolute, so each recorded key was resolved beside the baseline file
  // (the workspace root, whatever the member's depth) for the first lookup;
  // the raw key relativized against the baseline's directory is the symlink
  // fallback (on macOS /tmp and /private/tmp are one directory through two
  // paths).
  const absFloor = floors.abs.get(resolve(rec.sf));
  if (absFloor) return absFloor;
  const rel = relative(dirname(baselinePath), rec.sf);
  if (floors.files[rel]) return floors.files[rel];
  return floors.global;
}

/** `75% (3/4)` — the floor beside the level it failed. */
function fracText(frac) {
  return frac.found === 0
    ? "100% (nothing to measure)"
    : `${((frac.hit / frac.found) * 100).toFixed(2)}% (${frac.hit}/${frac.found})`;
}

/** `cur >= floor` on the exact fraction, cross-multiplied. */
function meets(hit, found, floor) {
  return found === 0 || hit * floor.found >= floor.hit * found;
}

const failing = [];
let tStF = 0,
  tStH = 0,
  tFnF = 0,
  tFnH = 0;

for (const r of Object.values(byFile)) {
  tStF += r.statements.found;
  tStH += r.statements.hit;
  tFnF += r.functions.found;
  tFnH += r.functions.hit;
  const floor = floorOf(r);
  const stPct = r.statements.found > 0 ? (r.statements.hit / r.statements.found) * 100 : 100;
  const fnPct = r.functions.found > 0 ? (r.functions.hit / r.functions.found) * 100 : 100;
  const below = [];
  if (!meets(r.statements.hit, r.statements.found, floor.statements)) {
    below.push(
      `statements ${stPct.toFixed(2)}%  (${r.statements.hit}/${r.statements.found}) — floor ${fracText(floor.statements)}`,
    );
  }
  if (!meets(r.functions.hit, r.functions.found, floor.functions)) {
    below.push(
      `functions ${fnPct.toFixed(2)}%  (${r.functions.hit}/${r.functions.found}) — floor ${fracText(floor.functions)}`,
    );
  }
  if (below.length > 0)
    failing.push(`${relative(process.cwd(), r.sf)}\n    ${below.join("\n    ")}`);
}

const totalStPct = tStF > 0 ? (tStH / tStF) * 100 : 100;
const totalFnPct = tFnF > 0 ? (tFnH / tFnF) * 100 : 100;

console.log(
  `coverage-gate: baseline ${existsSync(baselinePath) ? baselinePath : "none — every floor is 100%"} | ` +
    `global floor statements ${fracText(floors.global.statements)} functions ${fracText(floors.global.functions)} | ` +
    `statements ${totalStPct.toFixed(2)}% (${tStH}/${tStF}) | ` +
    `functions ${totalFnPct.toFixed(2)}% (${tFnH}/${tFnF}) across ${Object.keys(byFile).length} files`,
);

if (failing.length > 0) {
  console.error(`\n${failing.length} file(s) below their coverage floor:\n`);
  console.error(failing.join("\n\n"));
  process.exit(1);
}

// The changed-lines rule (the PR rule): every line the diff against the base
// ref adds or modifies must be executed. It layers on top of the per-file floor
// rather than replacing it, so a change to an uncovered line of a grandfathered
// file fails here even though the file meets its recorded floor.
//
// The rule is scoped to the files the coverage report instruments, and to the
// lines it records: a test file, a config, or a script the report does not list
// has no executed line to check, and a brace or a blank line carries no
// statement. Only a recorded line whose hit count is zero is a failure, so the
// rule fires on a line the report knows about and that the tests did not run.
const baseRef = resolveBaseRef();
const uncovered = [];
if (baseRef !== undefined) {
  const changed = changedLines(baseRef);
  const byAbs = new Map(Object.values(byFile).map((r) => [resolve(r.sf), r]));
  let checked = 0;
  let files = 0;
  for (const [abs, lineSet] of changed) {
    const rec = byAbs.get(abs);
    if (rec === undefined) continue;
    files += 1;
    const missed = [...lineSet].filter((n) => rec.lines.get(n) === 0).sort((a, b) => a - b);
    checked += lineSet.size;
    if (missed.length > 0) {
      uncovered.push(
        `${relative(process.cwd(), abs) || abs}\n    ${missed.length} uncovered changed line(s): ${missed.join(", ")}`,
      );
    }
  }
  console.log(
    `coverage-gate: changed-lines ${baseRef} | ${checked} changed line(s) across ${files} instrumented file(s)`,
  );
}

if (uncovered.length > 0) {
  console.error(`\n${uncovered.length} file(s) with uncovered changed lines:\n`);
  console.error(uncovered.join("\n\n"));
  process.exit(1);
}

console.log("coverage-gate: PASS — every file meets its floor");
if (baseRef !== undefined) console.log("coverage-gate: PASS — every changed line is covered");
