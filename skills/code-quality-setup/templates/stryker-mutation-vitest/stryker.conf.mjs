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

export default {
  concurrency: 4,
  // The vitest runner ignores this (it is always perTest); stated so the two
  // configs read the same.
  coverageAnalysis: "perTest",
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  ignorePatterns: ["node_modules", ".git", "reports", "coverage", "tmp"],
  jsonReporter: { fileName: "reports/mutation/report.json" },
  // The mutation scope. `scripts/` and `tools/` are deliberately outside it:
  // they are not the project's code, and `--mutate` on the command line would
  // otherwise pull a changed build script or vendored plugin into the set.
  mutate: [
    "src/**/*.ts",
    "!**/test/**",
    "!**/*.test.ts",
    "!**/*.d.ts",
    "!**/*-bin.ts",
    "!**/coverage/**",
  ],
  plugins: ["@stryker-mutator/vitest-runner"],
  reporters: ["html", "json", "clear-text", "progress"],
  // The vitest runner reads the top-level `testFiles` globs (the bun runner
  // reads its own `bun.testFiles` directory list instead).
  testFiles: ["test/**/*.test.ts"],
  testRunner: "vitest",
  // The gate: `break` is the threshold that sets the exit code (Stryker 10),
  // floored at the baseline's global mutation score; `high`/`low` only colour
  // the report, so a config with `high`/`low` alone never fails a build.
  thresholds: { break: breakAt, high: 100, low: breakAt },
};
