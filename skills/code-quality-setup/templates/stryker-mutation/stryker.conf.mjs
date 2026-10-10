import { readFileSync } from "node:fs";

// The mutation floor: `gates.mutation.global` from the committed baseline
// `.code-quality-baseline.json` (written by the skill's `score.mjs --raise`),
// as Stryker's `break` score. A score is a whole percentage, so it cannot
// carry the exact fraction — `scripts/mutation-gate.ts` enforces the per-file
// floors exactly from the report — and it is rounded DOWN so the config is
// never stricter than the recorded floor. No baseline, or one whose mutation
// gate was never raised, means 100: any survivor fails, the greenfield wall.
function breakThreshold() {
  try {
    // SAFETY: the baseline is JSON written by score.mjs; only the mutation
    // gate's `global` fraction is read.
    const baseline = JSON.parse(
      readFileSync(new URL("./.code-quality-baseline.json", import.meta.url), "utf8"),
    );
    const g = baseline?.gates?.mutation?.global;
    if (Number.isInteger(g?.killed) && Number.isInteger(g?.total) && g.total > 0) {
      return Math.floor((g.killed / g.total) * 100);
    }
  } catch {
    // no baseline — the greenfield wall
  }
  return 100;
}

const breakAt = breakThreshold();

// The shared Stryker base. In a single-package repo this file is the config
// Stryker runs; in a workspace each member's `stryker.conf.mjs` imports it and
// overrides `mutate`/`testFiles`/`bun.testFiles` with its own member-relative
// scope (see `stryker.member.conf.mjs`).
export default {
  bun: {
    inspectorTimeout: 10000,
    smol: true,
    // The bun runner reads `bun.testFiles` (explicit list), NOT the top-level
    // `testFiles` globs. Without this, every mutant runs the full repo suite
    // and times out. Directories are accepted as bun test filters.
    testFiles: ["test/"],
  },
  concurrency: 4,
  coverageAnalysis: "perTest",
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  ignorePatterns: ["node_modules", ".git", "reports", "coverage", "tmp"],
  jsonReporter: { fileName: "reports/mutation/report.json" },
  // The mutation scope. `scripts/` and `tools/` are deliberately outside it:
  // the bun runner eagerly imports every file in the mutation set into the test
  // process ("eager modules from mutate globs"), so a script whose top-level
  // code exits non-zero aborts the dry run for the whole push.
  mutate: [
    "src/**/*.ts",
    "!**/test/**",
    "!**/*.test.ts",
    "!**/*.d.ts",
    "!**/*-bin.ts",
    "!**/coverage/**",
  ],
  plugins: ["@hughescr/stryker-bun-runner"],
  reporters: ["html", "json", "clear-text", "progress"],
  symlinkNodeModules: false,
  testFiles: ["test/**/*.test.ts"],
  testRunner: "bun",
  // The gate: `break` is the threshold that sets the exit code (Stryker 10),
  // floored at the baseline's global mutation score; `high`/`low` only colour
  // the report, so a config with `high`/`low` alone never fails a build.
  thresholds: { break: breakAt, high: 100, low: breakAt },
};
