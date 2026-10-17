/**
 * Type-aware lint gate — the type-aware rules, at a wall of zero.
 *
 * Runs oxlint with the type-aware config (`oxlint.type-aware.config.ts`) and
 * `--format json`, and fails on any diagnostic. The gate is a wall, not a
 * floor: the unified baseline's `lint` count is the syntactic run's diagnostic
 * count, a different measure, so this gate cannot read it — the same reason
 * `eslint-prettier`'s `lint` gate declares no floor. A project that cannot
 * reach zero suppresses the report with a reason (see
 * `docs/code-quality/practices/lint-suppressions.md`) or does not select this
 * recipe.
 *
 * `--disable-nested-config` makes the root config cover every file: the
 * type-aware pass analyses the whole project, so a workspace member's own
 * `oxlint.config.ts` must not narrow it.
 *
 * Invoked by the `lint:type-aware` script (`bun scripts/lint-type-aware-gate.mjs`
 * under Bun, `node scripts/lint-type-aware-gate.mjs` under npm and pnpm), so
 * `node_modules/.bin` is on the PATH and the `oxlint` binary resolves.
 *
 * Usage:
 *   bun scripts/lint-type-aware-gate.mjs
 *
 * Exit 0 when there is no diagnostic; exit 1 with a report otherwise.
 */
import { spawnSync } from "node:child_process";

const run = spawnSync(
  "oxlint",
  ["--config", "oxlint.type-aware.config.ts", "--disable-nested-config", "--format", "json"],
  { encoding: "utf8" },
);
if (run.error) {
  console.error(`lint-type-aware-gate: oxlint could not be run: ${run.error}`);
  process.exit(1);
}
let doc;
try {
  // SAFETY: oxlint --format json writes { diagnostics: [...] }; only the
  // diagnostics array is read.
  doc = JSON.parse(run.stdout ?? "");
} catch (err) {
  console.error(`lint-type-aware-gate: oxlint output is not JSON: ${err}`);
  process.stderr.write(run.stdout ?? "");
  process.exit(1);
}
const diagnostics = doc?.diagnostics ?? [];
const count = diagnostics.length;

console.log(`lint-type-aware-gate: ${count} diagnostic(s), wall 0`);
// Cap the listing: the count in the summary line is the gate's measure, and
// the listing is only orientation.
const LISTED = 20;
for (const diagnostic of diagnostics.slice(0, LISTED)) {
  console.log(
    `  ${diagnostic.filename ?? "?"} ${diagnostic.code ?? ""} ${diagnostic.severity ?? ""}`.trimEnd(),
  );
}
if (count > LISTED) console.log(`  … and ${count - LISTED} more`);

if (count > 0) {
  console.error(`\nlint-type-aware-gate: ${count} diagnostic(s) — the type-aware wall is 0`);
  process.exit(1);
}
console.log("lint-type-aware-gate: PASS — no type-aware diagnostic");
