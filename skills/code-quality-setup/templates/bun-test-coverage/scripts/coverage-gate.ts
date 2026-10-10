/**
 * Coverage gate — enforces the per-file coverage floor recorded in the
 * committed baseline.
 *
 * Reads bun's lcov output and `.code-quality-baseline.json` (written by the
 * skill's `score.mjs --raise`) and fails the build listing every file below
 * its floor on either line or function coverage.
 *
 * The floor for a file the baseline records is its exact `{hit, found}`
 * fraction under `gates.coverage.files`, compared by cross-multiplication so
 * no float rounding creeps in; a file the baseline does not record gets the
 * `gates.coverage.global` fraction. The same fraction is enforced on lines
 * and on functions. The global fraction over the whole project is
 * `score.mjs`'s comparison, not this gate's: a workspace member's own run
 * aggregates the member alone, and holding it to the workspace-wide fraction
 * would fail a member that is exactly at its recorded floor. With no
 * baseline — or a baseline whose coverage gate was never raised — every
 * floor is 100%, the greenfield wall, so a repo that never raised one is
 * gated exactly as before.
 *
 * Usage:
 *   bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage
 *   bun scripts/coverage-gate.ts --lcov coverage/lcov.info --baseline .code-quality-baseline.json
 *
 * Defaults: --lcov ./coverage/lcov.info, --baseline ./.code-quality-baseline.json.
 * Exit 0 when every file meets its floor; exit 1 with a report otherwise.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function parseArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** An exact fraction, as the baseline records it — never a rounded ratio. */
interface Frac {
  found: number;
  hit: number;
}

/** The baseline's `gates.coverage` block (scripts/SCORE-SCHEMA.md). */
interface CoverageFloor {
  files?: Record<string, Frac>;
  global?: Frac;
}

/** The baseline's coverage floors: `global` for unrecorded files, `files` per file. */
interface Floors {
  files: Map<string, Frac>;
  global: Frac;
}

interface Baseline {
  gates?: { coverage?: CoverageFloor };
}

/** The greenfield floor: 100%. */
const FULL: Frac = { found: 1, hit: 1 };

const lcovPath = parseArg("--lcov") ?? "coverage/lcov.info";
const baselinePath = parseArg("--baseline") ?? ".code-quality-baseline.json";

if (!existsSync(lcovPath)) {
  console.error(`coverage-gate: lcov not found at ${lcovPath}`);
  console.error(
    `Run first: bun test --coverage --coverage-reporter=lcov --coverage-dir=${"coverage"}`,
  );
  process.exit(1);
}

// The baseline's coverage floors: `global` is the floor for a file the baseline
// does not record, `files` its per-file floors. An unreadable baseline fails
// the gate — a floor file that cannot be read must not silently become 100%.
function readFloors(path: string): Floors {
  if (!existsSync(path)) return { files: new Map(), global: FULL };
  let doc: Baseline;
  try {
    // SAFETY: the baseline is JSON written by score.mjs; only the coverage
    // gate's `global` fraction and `files` map are read.
    doc = JSON.parse(readFileSync(path, "utf8")) as Baseline;
  } catch (err) {
    console.error(`coverage-gate: baseline ${path} is unreadable: ${err}`);
    process.exit(1);
  }
  const coverage = doc.gates?.coverage;
  return {
    files: new Map(
      Object.entries(coverage?.files ?? {}).map(([key, frac]) => [
        resolve(dirname(path), key),
        frac,
      ]),
    ),
    global: coverage?.global ?? FULL,
  };
}

const floors = readFloors(baselinePath);

const text = readFileSync(lcovPath, "utf-8");

interface CovFile {
  fnf: number;
  fnh: number;
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
  const rec = byFile[sf] ?? { fnf: 0, fnh: 0, lf: 0, lh: 0, sf };
  rec.lf += num("LF");
  rec.lh += num("LH");
  rec.fnf += num("FNF");
  rec.fnh += num("FNH");
  byFile[sf] = rec;
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
  if (!meets(r.lh, r.lf, floor) || !meets(r.fnh, r.fnf, floor)) {
    failing.push(
      `${r.sf}\n    lines ${linePct.toFixed(2)}%  (${r.lh}/${r.lf}) — floor ${fracText(floor)}\n    funcs ${funcPct.toFixed(2)}%  (${r.fnh}/${r.fnf}) — floor ${fracText(floor)}`,
    );
  }
}

const totalLinePct = tLF > 0 ? (tLH / tLF) * 100 : 100;
const totalFuncPct = tFNF > 0 ? (tFNH / tFNF) * 100 : 100;

console.log(
  `coverage-gate: baseline ${existsSync(baselinePath) ? baselinePath : "none — every floor is 100%"} | ` +
    `global floor ${fracText(floors.global)} | ` +
    `lines ${totalLinePct.toFixed(2)}% (${tLH}/${tLF}) | ` +
    `funcs ${totalFuncPct.toFixed(2)}% (${tFNH}/${tFNF}) across ${Object.keys(byFile).length} files`,
);

if (failing.length > 0) {
  console.error(`\n${failing.length} file(s) below their coverage floor:\n`);
  console.error(failing.join("\n\n"));
  process.exit(1);
}

console.log("coverage-gate: PASS — every file meets its floor");
