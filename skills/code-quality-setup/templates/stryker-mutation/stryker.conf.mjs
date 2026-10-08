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
  // they have no covering test, so instrumenting them fails the dry run.
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
  // Hard gate: any survivor (or no-coverage file) fails the run.
  thresholds: { high: 100, low: 100 },
};
