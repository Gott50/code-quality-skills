import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The recorded global coverage floor: `gates.coverage.global.statements` from
// the committed baseline `.code-quality-baseline.json` (written by the skill's
// `score.mjs --raise`), as a whole percentage rounded DOWN so the threshold
// is never stricter than the recorded floor. The caller checks the baseline
// exists; a baseline whose coverage gate was never raised, or an unreadable
// one, means 100: the greenfield wall.
// The recorded fraction as a whole percentage, rounded down so the threshold
// is never stricter than the floor it reads; 100 when the block is absent or
// malformed (the greenfield wall).
function floorPercent(fraction: { found?: number; hit?: number } | undefined): number {
  if (!Number.isInteger(fraction?.hit) || !Number.isInteger(fraction?.found)) return 100;
  const { found, hit } = fraction;
  if (found === undefined || hit === undefined || found <= 0) return 100;
  return Math.floor((hit / found) * 100);
}

function recordedFloor(baselinePath: string): number {
  try {
    // The parse is unannotated on purpose: `JSON.parse` returns `any`, so the
    // baseline's `gates.coverage.global.statements` is read directly. An
    // `as { … }` here would assert the shape instead of checking it, which the
    // anti-slop rule flags; the `Number.isInteger` checks below are the decode.
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    return floorPercent(baseline?.gates?.coverage?.global?.statements);
  } catch {
    // an unreadable baseline is the greenfield wall, not a silent zero
  }
  return 100;
}

// The threshold applies only where this config IS the whole workspace run:
// the single-package repo, whose config sits beside the baseline — which
// `{{root}}` names, this member's path back to the workspace root, where the
// baseline lives. A workspace member's run aggregates the member alone, and
// holding it to the workspace-wide fraction would fail a member that is
// exactly at its recorded floor — so a member config disables the threshold
// (0) and leaves the per-file floors to `scripts/coverage-gate.mjs`, which
// the `test` script runs after vitest. No baseline is the greenfield wall
// for every config, member or root.
function globalFloor(): number {
  // A plain path, not `new URL(…, import.meta.url)`: the URL form is what
  // fallow reads as a module import, and the baseline does not exist until
  // `score.mjs --raise` writes it, so the URL form is a dead-code finding.
  const here = dirname(fileURLToPath(import.meta.url));
  const baselinePath = join(here, "{{root}}", ".code-quality-baseline.json");
  if (!existsSync(baselinePath)) return 100;
  if (here !== dirname(baselinePath)) return 0;
  return recordedFloor(baselinePath);
}

const floor = globalFloor();

export default defineConfig({
  test: {
    coverage: {
      exclude: ["**/*-bin.ts"],
      include: ["src/**/*.ts"],
      provider: "istanbul",
      reporter: ["text", "json"],
      // Global only, and on `statements` — the metric the baseline records
      // (istanbul's `s` map; SCORE-SCHEMA.md). `lines` has a different
      // denominator (a line with two statements counts once), so flooring it
      // with the statement fraction fails a project exactly at its floor. The
      // per-file floors are the gate script's, because a per-file threshold
      // here would apply the global fraction to every file — stricter than
      // the baseline's own per-file floors.
      thresholds: { statements: floor },
    },
  },
});
