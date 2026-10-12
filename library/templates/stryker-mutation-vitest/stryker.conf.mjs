import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The baseline sits beside this config — the workspace root — not beside the
// cwd, because a member's Stryker run imports this file from its own
// directory. A plain path, not `new URL(…, import.meta.url)`: the baseline is
// a data file read at run time, and the URL form is what a static analyzer
// (fallow) reads as a module import — one that does not resolve until
// `score.mjs --raise` has written the file, so the skill's own config would
// be the repo's dead-code finding.
const BASELINE = join(dirname(fileURLToPath(import.meta.url)), ".code-quality-baseline.json");

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
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
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
  // The `command` runner, not `vitest`: `@stryker-mutator/vitest-runner` 10.0.0
  // is broken on Vitest 5. Vitest 5 matches `testNamePattern` against the suite
  // chain joined with " > " (a documented breaking change), while the runner
  // builds that pattern from names it joins with a single space — so the
  // per-test filter matches nothing, every covered mutant runs zero tests and
  // is reported Survived (stryker-js#6210, fix still unreleased in #6214). The
  // `command` runner drives the real `vitest` CLI and reads its exit code, so
  // it is immune to the runner's internals. The cost is the whole suite per
  // mutant instead of the covering tests; the gate scopes `--mutate` to the
  // changed files, which keeps that bounded.
  commandRunner: { command: "npx vitest run" },
  concurrency: 4,
  // The `command` runner reports no per-test coverage, so there is nothing to
  // analyse; `perTest` would be a lie. The gate's floors come from the report
  // JSON, not from coverage analysis.
  coverageAnalysis: "off",
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  // `.claude` and `.agents` are the skills CLI's install dirs: `.claude/skills/<name>`
  // is a symlink, and Stryker's sandbox copy dies with ENOTSUP on it (#138).
  // Excluding them also keeps the skill's own test files out of the sandbox,
  // where `npx vitest run` would otherwise pick them up.
  ignorePatterns: ["node_modules", ".git", "reports", "coverage", "tmp", ".claude", ".agents"],
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
  reporters: ["html", "json", "clear-text", "progress"],
  testRunner: "command",
  // The gate: `break` is the threshold that sets the exit code (Stryker 10),
  // floored at the baseline's global mutation score; `high`/`low` only colour
  // the report, so a config with `high`/`low` alone never fails a build.
  thresholds: { break: breakAt, high: 100, low: breakAt },
};
