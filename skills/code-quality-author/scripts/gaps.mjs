#!/usr/bin/env node
// gaps.mjs — the code-quality-author gap analysis.
//
// Zero dependencies, node builtins only. Spawns the sibling `code-quality-setup` skill's detector
// and reads its report, then ranks the two kinds of gap the authoring skill acts on:
//
//   1. uncovered-category — a tooling category the project already uses that no selected recipe
//      addresses. Coverage is per (category, tool): a detected tool is addressed when a selected
//      recipe names it in `conflicts.tools`, writes one of the hit's own config files (a
//      `files[].path` equal to, or nested under, a detected file), or names it in a
//      `files[].path` / `gates[].run` / `commands[].run` (case-insensitive substring). One gap per
//      category that has at least one unaddressed tool.
//   2. one-predicate-away — a recipe that fails exactly one `requires` predicate, so a single
//      project change would make it applicable. A failing `language`/`packageManager`/`workspace`/
//      `excludes` reason is not a gap: the project cannot satisfy it.
//
// The detector is spawned, never imported: the skills CLI copies one skill directory per install,
// so the sibling sits next to this one at runtime (the same convention `code-quality-improve` uses
// for `code-quality-setup`'s `score.mjs`). The output shape is specified in GAPS-SCHEMA.md next to
// this file.
//
// Usage: node scripts/gaps.mjs [projectDir] [--library <path>] [--json]

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The sibling detector, resolved from this script's own location: the skills CLI installs each
// skill at `<skills root>/<name>/`, so `code-quality-setup` sits next to this one.
const DETECTOR = join(SKILL_DIR, "..", "code-quality-setup", "scripts", "detect.mjs");
// The library lives at the repo root, two levels up from the skill dir (skills/code-quality-author/).
// This is the repo-layout default; the fetched cache supplies its `libraryDir` through `--library`
// or $CODE_QUALITY_LIBRARY instead.
const DEFAULT_LIBRARY_DIR = resolve(SKILL_DIR, "..", "..", "library");

// The library directory to read recipes from: `--library <path>`, else $CODE_QUALITY_LIBRARY, else
// the repo-layout default. Resolved to an absolute path so a relative flag reads from the cwd.
function resolveLibraryDir(flag) {
  return resolve(flag ?? process.env.CODE_QUALITY_LIBRARY ?? DEFAULT_LIBRARY_DIR);
}

// The detector's stdout is a full applicability matrix; 64 MiB is far above any real report and
// keeps a large workspace from tripping the default 1 MiB buffer.
const MAX_BUFFER = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 1. Gap analysis
// ---------------------------------------------------------------------------

// `path` equals `entry`, or is nested under it when `entry` is a directory (the detector reports a
// directory hit as its inner files, or as `dir/` when empty).
function isUnder(path, entry) {
  return path === entry || path.startsWith(entry.endsWith("/") ? entry : `${entry}/`);
}

// A detected tool is addressed when a selected recipe covers it. `conflicts.tools` names the tool
// exactly; a `files[].path` equal to (or nested under) one of the hit's own detected config files
// is the recipe writing that file (e.g. `tsconfig.json`, `.husky/pre-commit`); the full-path/gate/
// command checks are a case-insensitive substring, because a recipe's own config path or gate
// command names the tool it installs.
function isAddressed(tool, files, selectedRecipes) {
  const needle = tool.toLowerCase();
  return selectedRecipes.some((r) => {
    if ((r.conflicts?.tools ?? []).includes(tool)) return true;
    const paths = (r.files ?? []).map((f) => f.path ?? "");
    if (paths.some((p) => files.some((entry) => isUnder(p, entry)))) return true;
    return (
      paths.some((p) => p.toLowerCase().includes(needle)) ||
      (r.gates ?? []).some((g) =>
        String(g.run ?? "")
          .toLowerCase()
          .includes(needle),
      ) ||
      (r.commands ?? []).some((c) =>
        String(c.run ?? "")
          .toLowerCase()
          .includes(needle),
      )
    );
  });
}

// (a) uncovered-category — one gap per category that has at least one unaddressed tool,
// aggregating every package that uses it. Coverage is per (category, tool), so a category is
// uncovered wherever an unaddressed tool appears.
function uncoveredCategories(report, selectedRecipes) {
  const byCategory = new Map();
  for (const pkg of report.packages ?? []) {
    for (const [category, hits] of Object.entries(pkg.tooling ?? {})) {
      if (!hits || hits.length === 0) continue;
      const unaddressed = hits.filter((h) => !isAddressed(h.tool, h.files ?? [], selectedRecipes));
      if (unaddressed.length === 0) continue;
      let gap = byCategory.get(category);
      if (!gap) {
        gap = { evidence: [], packages: new Set(), tools: new Set() };
        byCategory.set(category, gap);
      }
      for (const h of unaddressed) {
        gap.tools.add(h.tool);
        gap.evidence.push(`${pkg.path} ${category}: ${h.files.join(", ")}`);
        gap.packages.add(pkg.path);
      }
    }
  }
  return [...byCategory].map(([category, gap]) => ({
    category,
    evidence: gap.evidence,
    kind: "uncovered-category",
    packages: [...gap.packages].sort(),
    tools: [...gap.tools].sort(),
  }));
}

// (b) one-predicate-away — a non-selected recipe whose only failing check is a `requires`
// predicate. A failing `language`/`packageManager`/`workspace`/`excludes` reason is not a gap, and
// two or more failing reasons mean the project is further than one change away.
function onePredicateAway(report) {
  const gaps = [];
  for (const r of report.recipes ?? []) {
    if (r.error !== null || r.selected) continue;
    const failing = (r.reasons ?? []).filter((x) => x.pass === false);
    if (failing.length !== 1) continue;
    const f = failing[0];
    if (!String(f.predicate).startsWith("requires ")) continue;
    gaps.push({
      failing: { detail: f.detail, predicate: f.predicate },
      kind: "one-predicate-away",
      purpose: r.purpose,
      recipe: r.id,
      title: r.title,
    });
  }
  return gaps;
}

// Descending affected-package count, then category name.
function byCategory(a, b) {
  if (b.packages.length !== a.packages.length) return b.packages.length - a.packages.length;
  return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
}

// Recipe id, ascending.
function byRecipe(a, b) {
  return a.recipe < b.recipe ? -1 : a.recipe > b.recipe ? 1 : 0;
}

// Every (a) gap leads every (b) gap; within (a) by descending affected-package count then category
// name; within (b) by recipe id. `rank` is 1..n over the whole list.
function rankGaps(report, selectedRecipes) {
  const categories = uncoveredCategories(report, selectedRecipes).sort(byCategory);
  const oneAway = onePredicateAway(report).sort(byRecipe);
  return [...categories, ...oneAway].map((gap, i) => ({ rank: i + 1, ...gap }));
}

// ---------------------------------------------------------------------------
// 2. Report
// ---------------------------------------------------------------------------

function analyze(projectDir, libraryDir) {
  let stdout;
  try {
    stdout = execFileSync("node", [DETECTOR, projectDir, "--library", libraryDir], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // A detector hard error is the only failure that stops the run: its stderr is the message.
    const detail = (err.stderr ?? "").trim() || err.message;
    throw new Error(`detector failed — ${detail}`);
  }
  const report = JSON.parse(stdout);
  const selectedRecipes = (report.recipes ?? []).filter((r) => r.error === null && r.selected);
  return {
    gaps: rankGaps(report, selectedRecipes),
    libraryDir,
    root: report.root,
    schemaVersion: SCHEMA_VERSION,
    selection: report.selection ?? [],
  };
}

function printPlain(doc) {
  if (doc.gaps.length === 0) {
    process.stdout.write("no gaps\n");
    return;
  }
  const lines = doc.gaps.map((g) => {
    if (g.kind === "uncovered-category") {
      return `  ${g.rank}. uncovered-category: ${g.category} — ${g.tools.join(", ")} (${g.packages.join(", ")})`;
    }
    return `  ${g.rank}. one-predicate-away: ${g.recipe} — ${g.failing.predicate}`;
  });
  process.stdout.write(`gaps: ${doc.gaps.length}\n${lines.join("\n")}\n`);
}

try {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const libIdx = args.indexOf("--library");
  let libraryFlag = null;
  if (libIdx !== -1) {
    libraryFlag = args[libIdx + 1];
    if (libraryFlag === undefined) throw new Error("--library needs a path");
  }
  // Drop `--library` and its value so the value is never mistaken for the project dir.
  const rest = libIdx === -1 ? args : args.filter((_, i) => i !== libIdx && i !== libIdx + 1);
  const target = rest.find((a) => !a.startsWith("--")) ?? ".";
  const doc = analyze(target, resolveLibraryDir(libraryFlag));
  if (json) process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
  else printPlain(doc);
} catch (err) {
  process.stderr.write(`gaps.mjs: ${err.message}\n`);
  process.exit(1);
}
