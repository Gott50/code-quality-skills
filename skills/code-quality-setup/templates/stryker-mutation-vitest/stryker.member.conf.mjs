import base from "{{root}}/stryker.conf.mjs";

// A workspace member's Stryker config: the root base plus the member's own
// scope. Stryker reads its config from the cwd and resolves `mutate` and
// `testFiles` against it, so the gate runs this config from the member
// directory and every glob below is member-relative.
export default {
  ...base,
  // The report must land at the workspace root, not in the member: the gate
  // reads `reports/mutation/report.json` at the root for every config, while
  // Stryker resolves `jsonReporter.fileName` against its cwd (the member
  // directory). `{{root}}` is the member's path back to the workspace root, so
  // the two agree at any member depth. The incremental cache stays per-area.
  jsonReporter: { fileName: "{{root}}/reports/mutation/report.json" },
  mutate: [
    "src/**/*.ts",
    "!**/test/**",
    "!**/*.test.ts",
    "!**/*.d.ts",
    "!**/*-bin.ts",
    "!**/coverage/**",
  ],
  testFiles: ["test/**/*.test.ts"],
};
