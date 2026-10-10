/**
 * Typecheck gate — enforces the type-error floor recorded in the committed
 * baseline.
 *
 * Runs `tsc --noEmit --pretty false`, counts the diagnostics (the
 * `: error TS\d+` lines — the same count `score.mjs` reads), and compares
 * against `gates.typecheck.global` from `.code-quality-baseline.json`
 * (written by the skill's `score.mjs --raise`): the count must not exceed
 * the recorded count. With no baseline — or a baseline whose typecheck gate
 * was never raised — the floor is 0, the greenfield wall, so a repo that
 * never raised one is gated exactly as before: any type error fails.
 *
 * Invoked by the `typecheck` script (`bun scripts/typecheck-gate.mjs` under
 * Bun, `node scripts/typecheck-gate.mjs` under npm and pnpm), so
 * `node_modules/.bin` is on the PATH and the `tsc` binary resolves.
 *
 * Usage:
 *   bun scripts/typecheck-gate.mjs --baseline .code-quality-baseline.json
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

// The typecheck floor: the recorded type-error count. An unreadable baseline
// fails the gate — a floor file that cannot be read must not silently
// become 0.
function readFloor(path) {
  if (!existsSync(path)) return 0;
  try {
    // SAFETY: the baseline is JSON written by score.mjs; only the typecheck
    // gate's `global` count is read.
    const doc = JSON.parse(readFileSync(path, "utf8"));
    const count = doc?.gates?.typecheck?.global;
    return Number.isInteger(count) ? count : 0;
  } catch (err) {
    console.error(`typecheck-gate: baseline ${path} is unreadable: ${err}`);
    process.exit(1);
  }
}

const floor = readFloor(baselinePath);

const run = spawnSync("tsc", ["--noEmit", "--pretty", "false"], { encoding: "utf8" });
if (run.error) {
  console.error(`typecheck-gate: tsc could not be run: ${run.error}`);
  process.exit(1);
}
const output = run.stdout ?? "";
const count = output.split("\n").filter((line) => /: error TS\d+/.test(line)).length;

console.log(
  `typecheck-gate: baseline ${existsSync(baselinePath) ? baselinePath : "none — the floor is 0"} | ` +
    `${count} type error(s), floor ${floor}`,
);
process.stdout.write(output);
process.stderr.write(run.stderr ?? "");

if (count > floor) {
  console.error(`\ntypecheck-gate: ${count} type error(s) exceed the floor ${floor}`);
  process.exit(1);
}
console.log("typecheck-gate: PASS — the type-error count is at or below the floor");
