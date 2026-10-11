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
 * Usage (the `test` script runs it after `vitest run --coverage`):
 *   node scripts/coverage-gate.mjs --coverage coverage/coverage-final.json --baseline .code-quality-baseline.json
 *
 * Defaults: --coverage ./coverage/coverage-final.json,
 *           --baseline ./.code-quality-baseline.json.
 * Exit 0 when every file meets its floor; exit 1 with a report otherwise.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

function parseArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The greenfield floor: 100% on both metrics. */
const FULL = { functions: { found: 1, hit: 1 }, statements: { found: 1, hit: 1 } };

const coveragePath = parseArg("--coverage") ?? "coverage/coverage-final.json";
const baselinePath = parseArg("--baseline") ?? ".code-quality-baseline.json";

if (!existsSync(coveragePath)) {
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

// The baseline's coverage floors: `global` is the floor for a file the
// baseline does not record, `files` its per-file floors keyed as recorded
// (workspace-root-relative), and `abs` the same floors keyed by the absolute
// path each recorded key resolves to beside the baseline file — the form the
// Istanbul keys are matched in. An unreadable baseline fails the gate — a
// floor file that cannot be read must not silently become 100%. A coverage
// block that does not carry both metrics is unreadable too: the floor is per
// metric, and a missing one must not silently become 100%.
function readFloors(path) {
  if (!existsSync(path)) return { abs: new Map(), files: {}, global: FULL };
  let doc;
  try {
    // SAFETY: the baseline is JSON written by score.mjs; only the coverage
    // gate's `global` fraction and `files` map are read.
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`coverage-gate: baseline ${path} is unreadable: ${err}`);
    process.exit(1);
  }
  const coverage = doc?.gates?.coverage;
  if (coverage?.global !== undefined && !isCoverageFrac(coverage.global)) {
    console.error(`coverage-gate: baseline ${path} records no statements/functions floor`);
    process.exit(1);
  }
  const files = coverage?.files ?? {};
  for (const [key, frac] of Object.entries(files)) {
    if (!isCoverageFrac(frac)) {
      console.error(`coverage-gate: baseline ${path} records no statements/functions floor for ${key}`);
      process.exit(1);
    }
  }
  const abs = new Map(
    Object.entries(files).map(([key, frac]) => [resolve(dirname(path), key), frac]),
  );
  return { abs, files, global: coverage?.global ?? FULL };
}

const floors = readFloors(baselinePath);

// Istanbul's `coverage-final.json` is keyed by absolute path; each value
// carries an `s` statement hit map and an `f` function hit map. The level is
// hit / found per map, one exact fraction per metric (SCORE-SCHEMA.md).
function readIstanbul(doc) {
  const files = {};
  for (const [key, fc] of Object.entries(doc ?? {})) {
    const s = fc?.s ?? {};
    const f = fc?.f ?? {};
    files[key] = {
      functions: { found: Object.keys(f).length, hit: Object.values(f).filter((n) => n > 0).length },
      sf: key,
      statements: { found: Object.keys(s).length, hit: Object.values(s).filter((n) => n > 0).length },
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
  if (below.length > 0) failing.push(`${relative(process.cwd(), r.sf)}\n    ${below.join("\n    ")}`);
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

console.log("coverage-gate: PASS — every file meets its floor");
