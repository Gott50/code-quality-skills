import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The recorded global coverage floor: `gates.coverage.global` from the
// committed baseline `.code-quality-baseline.json` (written by the skill's
// `score.mjs --raise`), as a whole percentage rounded DOWN so the threshold
// is never stricter than the recorded floor. The caller checks the baseline
// exists; a baseline whose coverage gate was never raised, or an unreadable
// one, means 100: the greenfield wall.
function recordedFloor(baselinePath: URL): number {
  try {
    // SAFETY: the baseline is JSON written by score.mjs; only the coverage
    // gate's `global` fraction is read.
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
      gates?: { coverage?: { global?: { found?: number; hit?: number } } };
    };
    const g = baseline.gates?.coverage?.global;
    if (Number.isInteger(g?.hit) && Number.isInteger(g?.found) && g.found > 0) {
      return Math.floor((g.hit / g.found) * 100);
    }
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
  const baselinePath = new URL("{{root}}/.code-quality-baseline.json", import.meta.url);
  if (!existsSync(baselinePath)) return 100;
  if (dirname(fileURLToPath(import.meta.url)) !== dirname(fileURLToPath(baselinePath))) return 0;
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
