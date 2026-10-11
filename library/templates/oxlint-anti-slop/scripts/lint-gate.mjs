/**
 * Lint gate — enforces the lint floor recorded in the committed baseline.
 *
 * Runs oxlint with `--format json` and compares the diagnostic count against
 * `gates.lint.global` from `.code-quality-baseline.json` (written by the
 * skill's `score.mjs --raise`): the count must not exceed the recorded count.
 * With no baseline — or a baseline whose lint gate was never raised — the
 * floor is 0, the greenfield wall, so a repo that never raised one is gated
 * exactly as before: any diagnostic fails.
 *
 * Invoked by the `lint` script (`bun scripts/lint-gate.mjs` under Bun,
 * `node scripts/lint-gate.mjs` under npm and pnpm), so `node_modules/.bin`
 * is on the PATH and the `oxlint` binary resolves.
 *
 * Usage:
 *   bun scripts/lint-gate.mjs --baseline .code-quality-baseline.json
 *
 * Defaults: --baseline ./.code-quality-baseline.json.
 * Exit 0 when the count is at or below the floor; exit 1 with a report
 * otherwise.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function parseArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const baselinePath = parseArg("--baseline") ?? ".code-quality-baseline.json";

// The lint floor: the recorded diagnostic count. An unreadable baseline
// fails the gate — a floor file that cannot be read must not silently
// become 0.
function readFloor(path) {
  if (!existsSync(path)) return 0;
  try {
    // SAFETY: the baseline is JSON written by score.mjs; only the lint
    // gate's `global` count is read.
    const doc = JSON.parse(readFileSync(path, "utf8"));
    const count = doc?.gates?.lint?.global;
    return Number.isInteger(count) ? count : 0;
  } catch (err) {
    console.error(`lint-gate: baseline ${path} is unreadable: ${err}`);
    process.exit(1);
  }
}

const floor = readFloor(baselinePath);

const run = spawnSync("oxlint", ["--format", "json"], { encoding: "utf8" });
if (run.error) {
  console.error(`lint-gate: oxlint could not be run: ${run.error}`);
  process.exit(1);
}
let doc;
try {
  // SAFETY: oxlint --format json writes { diagnostics: [...] }; only the
  // diagnostics array is read.
  doc = JSON.parse(run.stdout ?? "");
} catch (err) {
  console.error(`lint-gate: oxlint output is not JSON: ${err}`);
  process.stderr.write(run.stdout ?? "");
  process.exit(1);
}
const diagnostics = doc?.diagnostics ?? [];
const count = diagnostics.length;

console.log(
  `lint-gate: baseline ${existsSync(baselinePath) ? baselinePath : "none — the floor is 0"} | ` +
    `${count} diagnostic(s), floor ${floor}`,
);
// Cap the listing: a debt repo can carry hundreds of diagnostics, and the
// count in the summary line is the gate's measure — the listing is only
// orientation.
const LISTED = 20;
for (const diagnostic of diagnostics.slice(0, LISTED)) {
  console.log(
    `  ${diagnostic.filename ?? "?"} ${diagnostic.code ?? ""} ${diagnostic.severity ?? ""}`.trimEnd(),
  );
}
if (count > LISTED) console.log(`  … and ${count - LISTED} more`);

if (count > floor) {
  console.error(`\nlint-gate: ${count} diagnostic(s) exceed the floor ${floor}`);
  process.exit(1);
}
console.log("lint-gate: PASS — the diagnostic count is at or below the floor");
