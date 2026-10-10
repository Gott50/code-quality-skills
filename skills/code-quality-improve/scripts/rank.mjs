#!/usr/bin/env node
// rank.mjs — the code-quality-improve ranking view.
//
// Zero dependencies, node builtins only. Reads the artifacts the gates already produced and prints
// the ranked improvement targets: fallow's own `--targets` ranking first, then the coverage gaps,
// lint violations and typecheck errors folded in as additional candidates. It never runs a gate and
// never invokes a package manager: the artifacts must already exist. A missing artifact is a
// reported gap, never a crash.
//
// The readers are this skill's own, not an import from the sibling `code-quality-setup` skill: the
// skills CLI copies one skill directory per install, so a relative import across skill directories
// would not resolve in a consumer's project. The one thing this skill does NOT reimplement is the
// floor merge — the raise step invokes the sibling's `score.mjs --raise` (see `raiseCommand`).
//
// Usage: node scripts/rank.mjs [projectDir] [--json]
//
// The output shape is specified in RANK-SCHEMA.md next to this file.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const BASELINE_NAME = ".code-quality-baseline.json";

// The artifact each source is read from, relative to the project root. The fallow targets are a
// captured stdout (fallow writes no file of its own), like the score view's captures.
const ARTIFACTS = {
  fallowTargets: "reports/fallow-targets.json",
  lcov: "coverage/lcov.info",
  istanbul: "coverage/coverage-final.json",
  oxlint: "reports/oxlint.json",
  tsc: "reports/tsc.log",
};

// The capture command for each artifact, printed in the gap report so the agent knows how to
// produce it. The fallow capture is the ranking command itself.
const CAPTURE = {
  fallowTargets: "fallow health --targets --format json > reports/fallow-targets.json",
  lcov: "bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage",
  istanbul: "vitest run --coverage",
  oxlint: "oxlint --format json > reports/oxlint.json",
  tsc: "tsc --noEmit --pretty false > reports/tsc.log",
};

// The sibling skill's score view, resolved from this script's own location: the skills CLI installs
// each skill at `<skills root>/<name>/`, so the sibling sits next to this one. The raise step
// invokes it; the merge is never reimplemented here.
const SIBLING_SCORE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "code-quality-setup",
  "scripts",
  "score.mjs",
);

// ---------------------------------------------------------------------------
// Artifact readers
// ---------------------------------------------------------------------------

// bun's lcov: one `SF:`-delimited record per file, `LF`/`LH` (lines found/hit) and `FNF`/`FNH`
// (functions found/hit). No global record. Records may repeat an `SF`; accumulate per file.
export function readLcov(text) {
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
    const rec = files[sf] ?? { functions: { found: 0, hit: 0 }, lines: { found: 0, hit: 0 } };
    rec.lines.found += num("LF");
    rec.lines.hit += num("LH");
    rec.functions.found += num("FNF");
    rec.functions.hit += num("FNH");
    files[sf] = rec;
  }
  return files;
}

// The number of entries in an Istanbul hit map that were hit at least once.
function countHit(map) {
  return Object.values(map).filter((n) => n > 0).length;
}

// vitest's Istanbul `coverage-final.json`: keyed by absolute path, each value an Istanbul
// FileCoverage with an `s` statement hit map and an `f` function hit map. The key is relativized to
// the project root.
export function readIstanbul(doc, bases) {
  const files = {};
  for (const [key, fc] of Object.entries(doc ?? {})) {
    const s = fc?.s ?? {};
    const f = fc?.f ?? {};
    files[relativize(key, bases)] = {
      functions: { found: Object.keys(f).length, hit: countHit(f) },
      statements: { found: Object.keys(s).length, hit: countHit(s) },
    };
  }
  return files;
}

// fallow's `health --targets` capture: the `targets` array. The key is OMITTED when there are no
// targets, so a missing key is an empty list, not an error.
export function readFallowTargets(doc) {
  return Array.isArray(doc?.targets) ? doc.targets : [];
}

// oxlint's `--format json`: `diagnostics[]`, each with a project-relative `filename`. Group by file.
export function readOxlint(doc) {
  const files = {};
  for (const d of doc?.diagnostics ?? []) {
    const file = typeof d?.filename === "string" ? d.filename : "(unknown)";
    files[file] = (files[file] ?? 0) + 1;
  }
  return files;
}

// tsc has no JSON reporter: one line per diagnostic, `file(l,c): error TSxxxx: …`. The file is the
// text before the `(l,c)`. A line matching `: error TS\d+` always carries a file prefix (a global
// error reads `error TSxxxx:` with no leading colon), so the prefix is the file.
export function readTsc(text) {
  const files = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(": error TS");
    if (i < 0) continue;
    const head = line.slice(0, i);
    const p = head.indexOf("(");
    const file = (p >= 0 ? head.slice(0, p) : head).trim() || "(unknown)";
    files[file] = (files[file] ?? 0) + 1;
  }
  return files;
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export function readBaseline(path) {
  if (!existsSync(path)) return { doc: null, error: null };
  try {
    return { doc: JSON.parse(readFileSync(path, "utf8")), error: null };
  } catch (err) {
    return { doc: null, error: String(err?.message ?? err) };
  }
}

// `cur >= floor` on the exact fraction, cross-multiplied so no float rounding creeps in. A gate
// with nothing to measure (found/total 0) is 100%. The same comparison the score view makes.
export function atLeast(cur, floor) {
  const cf = cur.found ?? cur.total ?? 0;
  const ff = floor.found ?? floor.total ?? 0;
  const ch = cur.hit ?? cur.killed ?? 0;
  const fh = floor.hit ?? floor.killed ?? 0;
  if (ff === 0 || cf === 0) return true;
  return ch * ff >= fh * cf;
}

// Whether a coverage file breaches its recorded floor: the per-file floor when the baseline records
// one, else the global floor (a new file gets the project's global floor, #62). A metric the
// baseline does not carry is skipped.
function coverageBelowFloor(metrics, file, baseline) {
  const cov = baseline?.gates?.coverage;
  if (!cov) return false;
  const floor = cov.files?.[file] ?? cov.global;
  if (!floor) return false;
  for (const [metric, frac] of Object.entries(metrics)) {
    const f = floor[metric];
    if (f && !atLeast(frac, f)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

// The number of uncovered items across a file's metrics.
function uncoveredOf(metrics) {
  let n = 0;
  for (const frac of Object.values(metrics)) n += Math.max(0, frac.found - frac.hit);
  return n;
}

// Read every artifact that exists and build the ranked target list. A missing artifact is a gap
// (with its capture command), never a crash; a malformed one is a gap too.
export function collect(root, bases) {
  const sources = {};
  const gaps = [];
  const targets = [];

  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

  // baseline — the recorded floors, read for the `below floor` marks and the lint/typecheck floors
  const baselinePath = join(root, BASELINE_NAME);
  const baseline = readBaseline(baselinePath);
  sources.baseline = {
    path: BASELINE_NAME,
    present: Boolean(baseline.doc),
    schemaVersion: baseline.doc?.schemaVersion ?? null,
    error: baseline.error,
  };
  if (baseline.error) {
    gaps.push({ source: "baseline", path: BASELINE_NAME, reason: `unreadable: ${baseline.error}` });
  } else if (!baseline.doc) {
    gaps.push({
      source: "baseline",
      path: BASELINE_NAME,
      reason: "absent — the setup skill's apply (or `score.mjs --raise`) records one",
    });
  }

  // fallow targets — the structured ranking
  const fallowPath = join(root, ARTIFACTS.fallowTargets);
  if (existsSync(fallowPath)) {
    try {
      const list = readFallowTargets(readJson(fallowPath));
      sources.fallow = { path: ARTIFACTS.fallowTargets, present: true, count: list.length, error: null };
      for (const t of list) {
        targets.push({
          source: "fallow",
          path: typeof t?.path === "string" ? t.path : "(unknown)",
          gate: t?.category === "remove_dead_code" ? "fallow-dead-code" : "fallow-health",
          detail: typeof t?.recommendation === "string" ? t.recommendation : "",
          priority: t?.priority ?? null,
          efficiency: t?.efficiency ?? null,
          effort: t?.effort ?? null,
          confidence: t?.confidence ?? null,
          category: t?.category ?? null,
          factors: Array.isArray(t?.factors) ? t.factors : [],
          evidence: t?.evidence ?? null,
          actions: Array.isArray(t?.actions) ? t.actions : [],
        });
      }
    } catch (err) {
      sources.fallow = { path: ARTIFACTS.fallowTargets, present: true, count: 0, error: String(err?.message ?? err) };
      gaps.push({ source: "fallow", path: ARTIFACTS.fallowTargets, reason: `unreadable: ${err?.message ?? err}` });
    }
  } else {
    sources.fallow = { path: ARTIFACTS.fallowTargets, present: false, count: 0, error: null };
    gaps.push({ source: "fallow", path: ARTIFACTS.fallowTargets, reason: `absent — capture it with \`${CAPTURE.fallowTargets}\`` });
  }

  // coverage — bun's lcov first, then vitest's Istanbul JSON
  const lcovPath = join(root, ARTIFACTS.lcov);
  const istanbulPath = join(root, ARTIFACTS.istanbul);
  let covFiles = null;
  let covSource = null;
  let covPath = ARTIFACTS.lcov;
  if (existsSync(lcovPath)) {
    covPath = ARTIFACTS.lcov;
    covSource = "lcov";
    try {
      covFiles = readLcov(readFileSync(lcovPath, "utf8"));
    } catch (err) {
      gaps.push({ source: "coverage", path: ARTIFACTS.lcov, reason: `unreadable: ${err?.message ?? err}` });
    }
  } else if (existsSync(istanbulPath)) {
    covPath = ARTIFACTS.istanbul;
    covSource = "istanbul";
    try {
      covFiles = readIstanbul(readJson(istanbulPath), bases);
    } catch (err) {
      gaps.push({ source: "coverage", path: ARTIFACTS.istanbul, reason: `unreadable: ${err?.message ?? err}` });
    }
  }
  if (covFiles) {
    const rows = Object.entries(covFiles)
      .map(([file, metrics]) => ({ file, metrics, uncovered: uncoveredOf(metrics) }))
      .filter((r) => r.uncovered > 0)
      .sort((a, b) => b.uncovered - a.uncovered || a.file.localeCompare(b.file));
    sources.coverage = { path: covPath, present: true, source: covSource, files: rows.length, error: null };
    for (const r of rows) {
      targets.push({
        source: "coverage",
        path: r.file,
        gate: "coverage",
        detail: `${r.uncovered} uncovered`,
        metrics: r.metrics,
        uncovered: r.uncovered,
        belowFloor: coverageBelowFloor(r.metrics, r.file, baseline.doc),
      });
    }
  } else {
    sources.coverage = { path: covPath, present: false, source: null, files: 0, error: null };
    gaps.push({
      source: "coverage",
      path: covPath,
      reason: `absent — capture it with \`${CAPTURE.lcov}\` (bun) or \`${CAPTURE.istanbul}\` (vitest)`,
    });
  }

  // lint — oxlint's captured JSON
  const oxlintPath = join(root, ARTIFACTS.oxlint);
  if (existsSync(oxlintPath)) {
    try {
      const files = readOxlint(readJson(oxlintPath));
      const rows = Object.entries(files).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const count = rows.reduce((n, [, c]) => n + c, 0);
      const floor = baseline.doc?.gates?.lint?.global;
      sources.lint = {
        path: ARTIFACTS.oxlint,
        present: true,
        count,
        files: rows.length,
        floor: typeof floor === "number" ? floor : null,
        error: null,
      };
      for (const [file, c] of rows) {
        targets.push({ source: "lint", path: file, gate: "lint", detail: `${c} diagnostic(s)`, count: c });
      }
    } catch (err) {
      sources.lint = { path: ARTIFACTS.oxlint, present: true, count: 0, files: 0, floor: null, error: String(err?.message ?? err) };
      gaps.push({ source: "lint", path: ARTIFACTS.oxlint, reason: `unreadable: ${err?.message ?? err}` });
    }
  } else {
    sources.lint = { path: ARTIFACTS.oxlint, present: false, count: 0, files: 0, floor: null, error: null };
    gaps.push({ source: "lint", path: ARTIFACTS.oxlint, reason: `absent — capture it with \`${CAPTURE.oxlint}\`` });
  }

  // typecheck — tsc's captured log
  const tscPath = join(root, ARTIFACTS.tsc);
  if (existsSync(tscPath)) {
    try {
      const files = readTsc(readFileSync(tscPath, "utf8"));
      const rows = Object.entries(files).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const count = rows.reduce((n, [, c]) => n + c, 0);
      const floor = baseline.doc?.gates?.typecheck?.global;
      sources.typecheck = {
        path: ARTIFACTS.tsc,
        present: true,
        count,
        files: rows.length,
        floor: typeof floor === "number" ? floor : null,
        error: null,
      };
      for (const [file, c] of rows) {
        targets.push({ source: "typecheck", path: file, gate: "typecheck", detail: `${c} error(s)`, count: c });
      }
    } catch (err) {
      sources.typecheck = { path: ARTIFACTS.tsc, present: true, count: 0, files: 0, floor: null, error: String(err?.message ?? err) };
      gaps.push({ source: "typecheck", path: ARTIFACTS.tsc, reason: `unreadable: ${err?.message ?? err}` });
    }
  } else {
    sources.typecheck = { path: ARTIFACTS.tsc, present: false, count: 0, files: 0, floor: null, error: null };
    gaps.push({ source: "typecheck", path: ARTIFACTS.tsc, reason: `absent — capture it with \`${CAPTURE.tsc}\`` });
  }

  // The rank: fallow's targets keep fallow's own order (it is the structured ranking); the
  // folded-in candidates follow, each group already ordered by severity.
  targets.forEach((t, i) => {
    t.rank = i + 1;
    t.raise = raiseCommand(t.gate, root);
  });

  return { sources, gaps, targets };
}

// ---------------------------------------------------------------------------
// The raise command
// ---------------------------------------------------------------------------

// The package manager the project uses, from its lockfile, then its `packageManager` field.
function detectPackageManager(root) {
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "package-lock.json"))) return "npm";
  const pkg = tryReadJson(join(root, "package.json"));
  const pm = typeof pkg?.packageManager === "string" ? pkg.packageManager : "";
  return pm.split("@")[0] || null;
}

// The command that raises the floor of the gate a target belongs to. The unified gates
// (coverage/mutation/lint/typecheck) are raised by the sibling skill's `score.mjs --raise` — the
// merge is never reimplemented here. fallow's gates are raised by the project's own `fallow:raise`
// script (the fallow-audit recipe installs it).
export function raiseCommand(gate, root) {
  if (gate === "fallow-health" || gate === "fallow-dead-code") {
    const pm = detectPackageManager(root);
    return pm ? `${pm} run fallow:raise` : "run the project's fallow:raise script";
  }
  if (!existsSync(SIBLING_SCORE)) {
    return "install code-quality-setup to raise the unified floor (its score.mjs --raise)";
  }
  return `node ${SIBLING_SCORE} ${root} --raise`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function pct(frac) {
  const found = frac.found ?? frac.total ?? 0;
  const hit = frac.hit ?? frac.killed ?? 0;
  return found > 0 ? `${((hit / found) * 100).toFixed(1)}%` : "100.0%";
}

function fracText(frac) {
  return `${frac.hit ?? frac.killed ?? 0}/${frac.found ?? frac.total ?? 0}`;
}

function coverageText(metrics) {
  return Object.entries(metrics)
    .map(([metric, frac]) => `${metric} ${pct(frac)} (${fracText(frac)})`)
    .join("  ");
}

function sourceLine(name, s) {
  const label = name.padEnd(16);
  if (!s.present) return `  ${label}${s.path} — absent`;
  if (s.error) return `  ${label}${s.path} — unreadable: ${s.error}`;
  switch (name) {
    case "baseline":
      return `  ${label}${s.path} (schemaVersion ${s.schemaVersion})`;
    case "fallow":
      return `  ${label}${s.path} — ${s.count} target(s)`;
    case "coverage":
      return `  ${label}${s.path} — ${s.files} file(s) with uncovered lines or functions`;
    case "lint": {
      const floor = s.floor == null ? "" : `   floor ${s.floor}${s.count > s.floor ? "   ⚠ above floor" : ""}`;
      return `  ${label}${s.path} — ${s.count} diagnostic(s) in ${s.files} file(s)${floor}`;
    }
    case "typecheck": {
      const floor = s.floor == null ? "" : `   floor ${s.floor}${s.count > s.floor ? "   ⚠ above floor" : ""}`;
      return `  ${label}${s.path} — ${s.count} error(s) in ${s.files} file(s)${floor}`;
    }
    default:
      return `  ${label}${s.path}`;
  }
}

function factorText(f) {
  return `${f?.metric} ${f?.value} > ${f?.threshold}`;
}

function evidenceText(ev) {
  if (!ev) return null;
  const parts = [];
  if (Array.isArray(ev.unused_exports) && ev.unused_exports.length) parts.push(`unused_exports ${ev.unused_exports.length}`);
  if (Array.isArray(ev.complex_functions) && ev.complex_functions.length) parts.push(`complex_functions ${ev.complex_functions.length}`);
  if (Array.isArray(ev.cycle_path) && ev.cycle_path.length) parts.push(`cycle_path ${ev.cycle_path.length}`);
  if (Array.isArray(ev.direct_callers) && ev.direct_callers.length) parts.push(`direct_callers ${ev.direct_callers.length}`);
  if (Array.isArray(ev.clone_siblings) && ev.clone_siblings.length) parts.push(`clone_siblings ${ev.clone_siblings.length}`);
  return parts.length ? parts.join("; ") : null;
}

function targetLines(t) {
  const lines = [];
  if (t.source === "fallow") {
    lines.push(
      `  ${t.rank}. [fallow] ${t.path}   priority ${t.priority}  efficiency ${t.efficiency}  ` +
        `effort ${t.effort}  confidence ${t.confidence}`,
    );
    if (t.detail) lines.push(`     ${t.category} — ${t.detail}`);
    if (t.factors.length) lines.push(`     factors: ${t.factors.map(factorText).join("; ")}`);
    const ev = evidenceText(t.evidence);
    if (ev) lines.push(`     evidence: ${ev}`);
    if (t.actions.length) lines.push(`     actions: ${t.actions.map((a) => a?.type).filter(Boolean).join("; ")}`);
  } else if (t.source === "coverage") {
    const mark = t.belowFloor ? "   ⚠ below floor" : "";
    lines.push(`  ${t.rank}. [coverage] ${t.path}   ${coverageText(t.metrics)}   uncovered ${t.uncovered}${mark}`);
  } else {
    lines.push(`  ${t.rank}. [${t.source}] ${t.path}   ${t.detail}`);
  }
  lines.push(`     raise: ${t.raise}`);
  return lines;
}

function renderText(report) {
  const lines = [];
  lines.push(`Improvement targets — ${report.root}`);
  lines.push("");
  for (const name of ["baseline", "fallow", "coverage", "lint", "typecheck"]) {
    lines.push(sourceLine(name, report.sources[name]));
  }
  lines.push("");
  if (report.targets.length === 0) {
    lines.push("  no targets — nothing to rank.");
  } else {
    for (const t of report.targets) lines.push(...targetLines(t));
  }
  if (report.gaps.length) {
    lines.push("");
    lines.push("  gaps:");
    for (const g of report.gaps) lines.push(`    ${g.source}: ${g.path} — ${g.reason}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isDir(path) {
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

export function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// An Istanbul key is absolute; the baseline keys are project-relative. Try the project root and its
// realpath (on macOS `/tmp` is a symlink to `/private/tmp`, so the two differ).
export function relativize(path, bases) {
  if (!isAbsolute(path)) return path;
  for (const base of bases) {
    const rel = relative(base, path);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  }
  return path;
}

// The canonical form a committed JSON file must have to survive the formatter recipes' `biome
// check .`: keys sorted, two spaces of indent, a trailing newline.
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
  const json = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--")) ?? ".";
  const root = resolve(target);
  if (!isDir(root)) {
    process.stderr.write(`rank: not a directory: ${target}\n`);
    process.exit(1);
  }

  const bases = [root, safeRealpath(root)];
  const { sources, gaps, targets } = collect(root, bases);
  const report = { schemaVersion: SCHEMA_VERSION, root, sources, gaps, targets };

  process.stdout.write(json ? canonicalJson(report) : `${renderText(report)}\n`);
  process.exit(0);
}

// Run only when executed directly, so an import does not run the view.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`rank: ${err?.message ?? err}\n`);
    process.exit(1);
  }
}
