#!/usr/bin/env node
// score.mjs — the code-quality score view.
//
// Zero dependencies, node builtins only. Reads each gate's artifact from the project and prints
// the per-gate level, with fallow's health score (the maintainability level) as the headline.
// `--raise` re-measures and writes the committed floor file, `.code-quality-baseline.json`.
//
// It never runs a gate and never invokes a package manager: the artifacts must already exist. The
// three gates whose level lives on stdout (oxlint, tsc, fallow) are read from a captured-output
// file under `reports/`; the capture commands are in SCORE-SCHEMA.md.
//
// Usage: node scripts/score.mjs [projectDir] [--raise] [--json]
//
// The output shape and the baseline schema are specified in SCORE-SCHEMA.md next to this file.

import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const SCHEMA_VERSION = 1;
const SKILL_VERSION = "1";
const BASELINE_NAME = ".code-quality-baseline.json";

// The artifact each gate writes, relative to the project root. The first three are the paths the
// recipes already fix; the last four are captured stdout (those tools write no file of their own).
const ARTIFACTS = {
  lcov: "coverage/lcov.info",
  istanbul: "coverage/coverage-final.json",
  mutation: "reports/mutation/report.json",
  oxlint: "reports/oxlint.json",
  tsc: "reports/tsc.log",
  fallowHealth: "reports/fallow-health.json",
  fallowDeadCode: "reports/fallow-dead-code.json",
};

// The gates the unified baseline holds. fallow's floors stay in fallow's own baseline files
// (health, dead-code, dupes — each its own format), so they are printed but never recorded here.
const BASELINE_GATES = ["coverage", "mutation", "lint", "typecheck"];

// ---------------------------------------------------------------------------
// Artifact readers
// ---------------------------------------------------------------------------

// bun's lcov: one `SF:`-delimited record per file, `LF`/`LH` (lines found/hit). No global record —
// the global is the sum. Records may repeat an `SF`; accumulate per file (the gate does the same).
function readLcov(text) {
  const files = {};
  for (const block of text.split(/(?=^SF:)/m)) {
    const lines = block.split("\n");
    const sf = lines
      .find((l) => l.startsWith("SF:"))
      ?.slice(3)
      .trim();
    if (!sf) continue;
    const num = (key) => {
      const line = lines.find((l) => l.startsWith(`${key}:`));
      return line ? Number(line.split(":")[1]) : 0;
    };
    const rec = files[sf] ?? { hit: 0, found: 0 };
    rec.found += num("LF");
    rec.hit += num("LH");
    files[sf] = rec;
  }
  return files;
}

// vitest's Istanbul `coverage-final.json`: keyed by absolute path, each value an Istanbul
// FileCoverage with an `s` hit map. The level is statements hit / statements found; there is no
// global summary, so the global is the sum. The key is relativized to the project root.
function readIstanbul(doc, bases) {
  const files = {};
  for (const [key, fc] of Object.entries(doc ?? {})) {
    const s = fc?.s ?? {};
    const found = Object.keys(s).length;
    const hit = Object.values(s).filter((n) => n > 0).length;
    files[relativize(key, bases)] = { hit, found };
  }
  return files;
}

// Stryker's `report.json`: `files[path].mutants[].status`. No score field — the level is
// killed / total, counted from the statuses. `total` is every mutant in the file.
function readMutation(doc) {
  const files = {};
  for (const [path, file] of Object.entries(doc?.files ?? {})) {
    const mutants = file?.mutants ?? [];
    files[path] = {
      killed: mutants.filter((m) => m?.status === "Killed").length,
      total: mutants.length,
    };
  }
  return files;
}

// fallow health: `health_score.score` (0–100) + `.grade` is the level; the maintainability average
// and the worst per-file CRAP are reported alongside.
function readFallowHealth(doc) {
  const hs = doc?.health_score ?? {};
  const craps = (doc?.file_scores ?? []).map((f) => f?.crap_max).filter((n) => typeof n === "number");
  return {
    score: typeof hs.score === "number" ? hs.score : null,
    grade: typeof hs.grade === "string" ? hs.grade : null,
    maintainability:
      typeof doc?.summary?.average_maintainability === "number" ? doc.summary.average_maintainability : null,
    crapMax: craps.length ? Math.max(...craps) : null,
  };
}

// tsc has no JSON reporter: one line per diagnostic, `file(l,c): error TSxxxx: …`. Count them.
function countTscErrors(text) {
  return text.split("\n").filter((line) => /: error TS\d+/.test(line)).length;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

function sumCoverage(files) {
  let hit = 0;
  let found = 0;
  for (const f of Object.values(files)) {
    hit += f.hit;
    found += f.found;
  }
  return { hit, found };
}

function sumMutation(files) {
  let killed = 0;
  let total = 0;
  for (const f of Object.values(files)) {
    killed += f.killed;
    total += f.total;
  }
  return { killed, total };
}

// Read every artifact that exists. A malformed artifact is reported, never fatal: one broken file
// must not cost the user the whole score. The gate is omitted and the error recorded.
function measure(root, bases) {
  const gates = {};
  const errors = [];
  const read = (gate, fn) => {
    try {
      return fn();
    } catch (err) {
      errors.push({ gate, error: String(err?.message ?? err) });
      return null;
    }
  };
  const json = (path) => JSON.parse(readFileSync(path, "utf8"));

  // coverage — bun's lcov first, then vitest's Istanbul JSON
  const lcovPath = join(root, ARTIFACTS.lcov);
  const istanbulPath = join(root, ARTIFACTS.istanbul);
  if (existsSync(lcovPath)) {
    const files = read("coverage", () => readLcov(readFileSync(lcovPath, "utf8")));
    if (files) gates.coverage = { source: "lcov", global: sumCoverage(files), files };
  } else if (existsSync(istanbulPath)) {
    const files = read("coverage", () => readIstanbul(json(istanbulPath), bases));
    if (files) gates.coverage = { source: "istanbul", global: sumCoverage(files), files };
  }

  const mutationPath = join(root, ARTIFACTS.mutation);
  if (existsSync(mutationPath)) {
    const files = read("mutation", () => readMutation(json(mutationPath)));
    if (files) gates.mutation = { global: sumMutation(files), files };
  }

  const oxlintPath = join(root, ARTIFACTS.oxlint);
  if (existsSync(oxlintPath)) {
    const g = read("lint", () => ({ global: (json(oxlintPath)?.diagnostics ?? []).length }));
    if (g) gates.lint = g;
  }

  const tscPath = join(root, ARTIFACTS.tsc);
  if (existsSync(tscPath)) {
    const g = read("typecheck", () => ({ global: countTscErrors(readFileSync(tscPath, "utf8")) }));
    if (g) gates.typecheck = g;
  }

  const healthPath = join(root, ARTIFACTS.fallowHealth);
  if (existsSync(healthPath)) {
    const g = read("fallowHealth", () => readFallowHealth(json(healthPath)));
    if (g) gates.fallowHealth = g;
  }

  const deadPath = join(root, ARTIFACTS.fallowDeadCode);
  if (existsSync(deadPath)) {
    const g = read("fallowDeadCode", () => ({ global: json(deadPath)?.total_issues ?? null }));
    if (g) gates.fallowDeadCode = g;
  }

  return { gates, errors };
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

// The floor file: the current level of every gate the unified baseline holds, as exact fractions.
// fallow's gates are not here — their floors live in fallow's own baseline files.
function baselineFrom(gates, versions) {
  const out = { schemaVersion: SCHEMA_VERSION, versions, gates: {} };
  for (const gate of BASELINE_GATES) {
    const g = gates[gate];
    if (!g) continue;
    out.gates[gate] =
      gate === "coverage" || gate === "mutation" ? { global: g.global, files: g.files } : { global: g.global };
  }
  return out;
}

function readBaseline(path) {
  if (!existsSync(path)) return { doc: null, error: null };
  try {
    return { doc: JSON.parse(readFileSync(path, "utf8")), error: null };
  } catch (err) {
    return { doc: null, error: String(err?.message ?? err) };
  }
}

// `cur >= floor` on the exact fraction, cross-multiplied so no float rounding creeps in. A gate
// with nothing to measure (found/total 0) is 100%.
function atLeast(cur, floor) {
  const cf = cur.found ?? cur.total ?? 0;
  const ff = floor.found ?? floor.total ?? 0;
  const ch = cur.hit ?? cur.killed ?? 0;
  const fh = floor.hit ?? floor.killed ?? 0;
  if (ff === 0 || cf === 0) return true;
  return ch * ff >= fh * cf;
}

// The ratchet's comparison (#62): per-file floors for coverage and mutation, one global count for
// lint and typecheck. A recorded file that is gone is not a regression (its entry drops on the
// next raise); a new file must meet the recorded global floor.
function compare(gates, baseline) {
  const regressions = [];
  const bg = baseline?.gates ?? {};

  for (const gate of ["coverage", "mutation"]) {
    const floor = bg[gate];
    const cur = gates[gate];
    if (!floor || !cur) continue;
    if (!atLeast(cur.global, floor.global)) {
      regressions.push({ gate, file: null, floor: floor.global, current: cur.global });
    }
    for (const [file, f] of Object.entries(floor.files ?? {})) {
      const c = cur.files[file];
      if (!c) continue;
      if (!atLeast(c, f)) regressions.push({ gate, file, floor: f, current: c });
    }
    for (const [file, c] of Object.entries(cur.files)) {
      if (floor.files?.[file]) continue;
      if (!atLeast(c, floor.global)) regressions.push({ gate, file, floor: floor.global, current: c });
    }
  }

  for (const gate of ["lint", "typecheck"]) {
    const floor = bg[gate];
    const cur = gates[gate];
    if (!floor || !cur) continue;
    if (typeof floor.global === "number" && typeof cur.global === "number" && cur.global > floor.global) {
      regressions.push({ gate, file: null, floor: floor.global, current: cur.global });
    }
  }

  return regressions;
}

// A recorded tool version changing invalidates the baseline (#62): the plan asks to re-measure.
// Only a change between two known versions counts — an unknown version cannot be said to have moved.
function versionMismatches(recorded, current) {
  const out = [];
  for (const tool of Object.keys(recorded ?? {})) {
    const r = recorded[tool];
    const c = current[tool];
    if (r != null && c != null && r !== c) out.push({ tool, recorded: r, current: c });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

// The declared version of each tool, from the project's package.json (dependencies or
// devDependencies); bun from the `packageManager` field. `null` when the project does not declare
// it. The skill's own version is a constant — the skill ships no package.json.
function readPackageVersions(root) {
  const pkg = tryReadJson(join(root, "package.json")) ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const pm = typeof pkg.packageManager === "string" ? pkg.packageManager : "";
  return {
    skill: SKILL_VERSION,
    bun: pm.startsWith("bun@") ? pm.slice(4) : null,
    vitest: deps.vitest ?? null,
    stryker: deps["@stryker-mutator/core"] ?? null,
    oxlint: deps.oxlint ?? null,
    typescript: deps.typescript ?? null,
    fallow: deps.fallow ?? null,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fmtScore(n) {
  return typeof n === "number" ? n.toFixed(1) : "—";
}

function fmtNum(n) {
  return typeof n === "number" ? String(n) : "—";
}

function fracText(frac) {
  const found = frac.found ?? frac.total ?? 0;
  const hit = frac.hit ?? frac.killed ?? 0;
  return `${hit}/${found}`;
}

function pct(frac) {
  const found = frac.found ?? frac.total ?? 0;
  const hit = frac.hit ?? frac.killed ?? 0;
  return found > 0 ? `${((hit / found) * 100).toFixed(1)}%` : "100.0%";
}

function fmtCoverage(cov) {
  return cov ? `${pct(cov.global)}  (${fracText(cov.global)})` : "—";
}

function fmtMutation(mut) {
  return mut ? `${pct(mut.global)}  (${fracText(mut.global)})` : "—";
}

function fmtCount(g) {
  return g && typeof g.global === "number" ? String(g.global) : "—";
}

function verdictText(score) {
  switch (score.verdict.state) {
    case "no-baseline":
      return "no baseline — run --raise to record one";
    case "stale":
      return "baseline stale — a recorded tool version changed; re-measure (--raise)";
    case "regression":
      return `REGRESSION — ${score.verdict.regressions.length} below the floor`;
    default:
      return "no regression";
  }
}

function regressionText(r) {
  if (r.gate === "coverage" || r.gate === "mutation") {
    return `${r.gate} ${r.file ?? "(global)"}: ${pct(r.current)} (${fracText(r.current)}) < floor ${pct(r.floor)} (${fracText(r.floor)})`;
  }
  return `${r.gate}: ${r.current} > floor ${r.floor}`;
}

function renderText(score) {
  const g = score.gates;
  const lines = [];
  lines.push(`Quality score — ${score.root}`);
  lines.push("");
  const fh = g.fallowHealth;
  if (fh) {
    lines.push(
      `  ${"fallow health".padEnd(16)}${fmtScore(fh.score)} (${fh.grade ?? "?"})   ` +
        `maintainability ${fmtNum(fh.maintainability)}   CRAP max ${fmtNum(fh.crapMax)}   ← headline`,
    );
  } else {
    lines.push(`  ${"fallow health".padEnd(16)}—   ← headline`);
  }
  lines.push("");
  lines.push(`  ${"coverage".padEnd(16)}${fmtCoverage(g.coverage)}`);
  lines.push(`  ${"mutation".padEnd(16)}${fmtMutation(g.mutation)}`);
  lines.push(`  ${"lint".padEnd(16)}${fmtCount(g.lint)}`);
  lines.push(`  ${"typecheck".padEnd(16)}${fmtCount(g.typecheck)}`);
  lines.push(`  ${"dead code".padEnd(16)}${fmtCount(g.fallowDeadCode)}`);
  lines.push("");
  if (score.baseline.present) {
    lines.push(`  ${"baseline".padEnd(16)}${score.baseline.path} (schemaVersion ${score.baseline.schemaVersion})`);
  } else if (score.baseline.error) {
    lines.push(`  ${"baseline".padEnd(16)}${score.baseline.path} — unreadable: ${score.baseline.error}`);
  } else {
    lines.push(`  ${"baseline".padEnd(16)}none`);
  }
  lines.push(`  ${"verdict".padEnd(16)}${verdictText(score)}`);
  if (score.verdict.regressions.length) {
    lines.push("");
    lines.push("  regressions:");
    for (const r of score.verdict.regressions) lines.push(`    ${regressionText(r)}`);
  }
  if (score.baseline.versionMismatch.length) {
    lines.push("");
    lines.push("  version mismatch (re-measure):");
    for (const m of score.baseline.versionMismatch) {
      lines.push(`    ${m.tool}: recorded ${m.recorded}, current ${m.current}`);
    }
  }
  if (score.errors.length) {
    lines.push("");
    lines.push("  warnings:");
    for (const e of score.errors) lines.push(`    ${e.gate}: ${e.error}`);
  }
  if (score.raised) {
    lines.push("");
    lines.push(`  baseline written: ${score.baseline.path}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function tryReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// An Istanbul key is absolute; the baseline keys are project-relative. Try the project root and its
// realpath (on macOS `/tmp` is a symlink to `/private/tmp`, so the two differ).
function relativize(path, bases) {
  if (!isAbsolute(path)) return path;
  for (const base of bases) {
    const rel = relative(base, path);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  }
  return path;
}

// The canonical form a committed JSON file must have to survive the formatter recipes' `biome
// check .`: keys sorted, two spaces of indent, a trailing newline (the same convention
// manifest.mjs writes `.code-quality.json` in).
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const raise = args.includes("--raise");
  const json = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--")) ?? ".";
  const root = resolve(target);
  if (!isDir(root)) {
    process.stderr.write(`score: not a directory: ${target}\n`);
    process.exit(1);
  }

  const bases = [root, safeRealpath(root)];
  const { gates, errors } = measure(root, bases);
  if (Object.keys(gates).length === 0) {
    if (errors.length) {
      process.stderr.write("score: no gate could be read:\n");
      for (const e of errors) process.stderr.write(`  ${e.gate}: ${e.error}\n`);
    } else {
      process.stderr.write(`score: no gate artifacts found under ${root}\n`);
      process.stderr.write("Run the gates first; the artifact paths are in SCORE-SCHEMA.md.\n");
    }
    process.exit(1);
  }

  const versions = readPackageVersions(root);
  const baselinePath = join(root, BASELINE_NAME);
  const baseline = readBaseline(baselinePath);
  let versionMismatch = baseline.doc ? versionMismatches(baseline.doc.versions, versions) : [];
  let regressions = baseline.doc ? compare(gates, baseline.doc) : [];
  let state = !baseline.doc ? "no-baseline" : versionMismatch.length ? "stale" : regressions.length ? "regression" : "ok";
  let raised = false;

  if (raise) {
    if (errors.length > 0) {
      process.stderr.write("score: refusing to raise — an artifact is unreadable:\n");
      for (const e of errors) process.stderr.write(`  ${e.gate}: ${e.error}\n`);
      process.exit(1);
    }
    writeFileSync(baselinePath, canonicalJson(baselineFrom(gates, versions)));
    versionMismatch = [];
    regressions = [];
    state = "ok";
    raised = true;
  }

  const score = {
    schemaVersion: SCHEMA_VERSION,
    root,
    headline: gates.fallowHealth
      ? { gate: "fallow-health", score: gates.fallowHealth.score, grade: gates.fallowHealth.grade }
      : null,
    gates,
    baseline: {
      present: Boolean(baseline.doc) || raised,
      path: BASELINE_NAME,
      schemaVersion: baseline.doc?.schemaVersion ?? (raised ? SCHEMA_VERSION : null),
      error: baseline.error,
      versionMismatch,
    },
    verdict: { state, regressions },
    errors,
    raised,
  };

  process.stdout.write(json ? canonicalJson(score) : `${renderText(score)}\n`);
  process.exit(state === "regression" ? 1 : 0);
}

try {
  main();
} catch (err) {
  process.stderr.write(`score: ${err?.message ?? err}\n`);
  process.exit(1);
}
