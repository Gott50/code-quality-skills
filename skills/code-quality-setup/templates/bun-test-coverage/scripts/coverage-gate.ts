/**
 * Coverage gate — enforces a minimum per-file coverage threshold.
 *
 * Reads bun's lcov output and fails the build listing every tracked source
 * file below the threshold on either line or function coverage.
 *
 * Usage:
 *   bun test --coverage --coverage-reporter=lcov --coverage-dir=/tmp/cov
 *   bun scripts/coverage-gate.ts --lcov /tmp/cov/lcov.info --threshold 100
 *
 * Defaults: --lcov ./coverage/lcov.info, --threshold 100.
 * Exit 0 when every file meets the threshold; exit 1 with a report otherwise.
 */
import { existsSync, readFileSync } from "node:fs";

function parseArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const lcovPath = parseArg("--lcov") ?? "coverage/lcov.info";
const threshold = Number(parseArg("--threshold") ?? "100");

if (!existsSync(lcovPath)) {
  console.error(`coverage-gate: lcov not found at ${lcovPath}`);
  console.error(
    `Run first: bun test --coverage --coverage-reporter=lcov --coverage-dir=${"coverage"}`,
  );
  process.exit(1);
}

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
  const linePct = r.lf > 0 ? (r.lh / r.lf) * 100 : 100;
  const funcPct = r.fnf > 0 ? (r.fnh / r.fnf) * 100 : 100;
  if (linePct < threshold || funcPct < threshold) {
    failing.push(
      `${r.sf}\n    lines ${linePct.toFixed(2)}%  (${r.lh}/${r.lf})\n    funcs ${funcPct.toFixed(2)}%  (${r.fnh}/${r.fnf})`,
    );
  }
}

const totalLinePct = tLF > 0 ? (tLH / tLF) * 100 : 100;
const totalFuncPct = tFNF > 0 ? (tFNH / tFNF) * 100 : 100;

console.log(
  `coverage-gate: threshold=${threshold}% | ` +
    `lines ${totalLinePct.toFixed(2)}% (${tLH}/${tLF}) | ` +
    `funcs ${totalFuncPct.toFixed(2)}% (${tFNH}/${tFNF}) across ${Object.keys(byFile).length} files`,
);

if (failing.length > 0) {
  console.error(`\n${failing.length} file(s) below ${threshold}% coverage:\n`);
  console.error(failing.join("\n\n"));
  process.exit(1);
}

console.log("coverage-gate: PASS — every file meets the threshold");
