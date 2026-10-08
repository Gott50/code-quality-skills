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
  // Hard gate: any survivor (or no-coverage file) fails the run.
  thresholds: { high: 100, low: 100 },
};
