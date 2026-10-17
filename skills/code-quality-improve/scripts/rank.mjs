#!/usr/bin/env node
// rank.mjs — the code-quality-improve ranking view.
//
// Zero dependencies, node builtins only. Reads the artifacts the gates already produced and prints
// the ranked improvement targets: the coverage gaps, the mutation gaps, lint violations, typecheck
// errors and fallow's dead-code findings folded in as candidates, then fallow's own `--targets`
// ranking. It never runs a gate and never invokes a package manager: the artifacts must already
// exist. A missing artifact is a reported gap, never a crash.
//
// The order is by effort tier, cheap first: the folded-in candidates are repo-owned (the artifact
// already exists and the fix needs no new harness), so they lead; fallow's targets follow by their
// own `effort` estimate, and within a tier fallow's own efficiency order (priority ÷ effort) is
// kept. Every candidate prints its `effort` and `confidence` — `—` where the source carries none.
// The full rule is in RANK-SCHEMA.md.
//
// The readers are this skill's own, not an import from the sibling `code-quality-setup` skill: the
// skills CLI copies one skill directory per install, so a relative import across skill directories
// would not resolve in a consumer's project. The one thing this skill does NOT reimplement is the
// floor merge — the raise step invokes the sibling's `score.mjs --raise` (see `raiseCommand`).
//
// Each candidate also carries the practice doc that covers its gate, read from the library's
// `practices/` and `recipes/` frontmatter (`--library`, else $CODE_QUALITY_LIBRARY, else the
// repo-layout default). With no library the pointer is omitted, never a crash.
//
// Usage: node scripts/rank.mjs [projectDir] [--library <path>] [--json]
//
// The output shape is specified in RANK-SCHEMA.md next to this file.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 2;
const BASELINE_NAME = ".code-quality-baseline.json";
// fallow's own dead-code floor: a per-category list of the known findings, separate from
// `.code-quality-baseline.json` (fallow's floors stay in fallow's own files, #77).
const DEAD_CODE_BASELINE_NAME = ".fallow-dead-code-baseline.json";

// The ranking's sort keys. The folded-in candidates are repo-owned — the artifact already exists and
// the fix needs no new harness — so they lead (tier 0); fallow's targets follow by their own effort
// estimate, and a capture that carried no effort sorts last. Confidence breaks an efficiency tie.
const EFFORT_TIER = { high: 3, low: 1, medium: 2 };
const CONFIDENCE_RANK = { high: 0, low: 2, medium: 1 };
const GROUP_ORDER = { coverage: 0, "dead-code": 4, lint: 2, mutation: 1, typecheck: 3 };

// The artifact each source is read from, relative to the project root. The fallow targets are a
// captured stdout (fallow writes no file of its own), like the score view's captures.
const ARTIFACTS = {
  deadCode: "reports/fallow-dead-code.json",
  fallowTargets: "reports/fallow-targets.json",
  istanbul: "coverage/coverage-final.json",
  lcov: "coverage/lcov.info",
  mutation: "reports/mutation/report.json",
  oxlint: "reports/oxlint.json",
  tsc: "reports/tsc.log",
};

// The capture command for each artifact, printed in the gap report so the agent knows how to
// produce it. The fallow capture is the ranking command itself.
const CAPTURE = {
  deadCode: "fallow dead-code --format json > reports/fallow-dead-code.json",
  fallowTargets: "fallow health --targets --format json > reports/fallow-targets.json",
  istanbul: "vitest run --coverage",
  lcov: "bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage",
  mutation: "stryker run",
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

// This skill's own directory, and the library directory the practice pointers are read from:
// `--library <path>`, else $CODE_QUALITY_LIBRARY, else the repo-layout default (`library/` two
// levels up from the skill dir) — the same resolution the setup skill's scripts use. Resolved to an
// absolute path so a relative flag reads from the cwd.
const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LIBRARY_DIR = resolve(SKILL_DIR, "..", "..", "library");

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

// Stryker's `report.json`: `files[path].mutants[]`, each with a `status` and a
// `location.start.line`. A mutant the suite did not kill is a gap: every status but `Killed` (the
// test caught it) and `Ignored` (a deliberate exclusion). `Survived`, `NoCoverage` and `Timeout`
// are the common ones; `RuntimeError` and `CompileError` are gaps too — the project's own mutation
// gate counts `killed` as `Killed` only and `total` as every mutant, so a `RuntimeError` mutant
// holds the file's level below 100% exactly like a survivor (#95). Per file: the level
// (`killed`/`total`) and the gaps, each with its line, status and mutator.
export function readMutation(doc) {
  const files = {};
  for (const [path, file] of Object.entries(doc?.files ?? {})) {
    const mutants = file?.mutants ?? [];
    const gaps = [];
    for (const m of mutants) {
      const status = typeof m?.status === "string" ? m.status : "(unknown)";
      if (status === "Killed" || status === "Ignored") continue;
      gaps.push({
        line: typeof m?.location?.start?.line === "number" ? m.location.start.line : null,
        mutatorName: typeof m?.mutatorName === "string" ? m.mutatorName : null,
        status,
      });
    }
    files[path] = {
      gaps,
      killed: mutants.filter((m) => m?.status === "Killed").length,
      total: mutants.length,
    };
  }
  return files;
}

// fallow's `health --targets` capture: the `targets` array. The key is OMITTED when there are no
// targets, so a missing key is an empty list, not an error.
export function readFallowTargets(doc) {
  return Array.isArray(doc?.targets) ? doc.targets : [];
}

// The file a dead-code finding points at. Most categories carry `path`; the ones that carry
// locations instead (duplicate exports, unlisted dependencies) and the boundary violations are
// read from their first location. A finding with none is `(unknown)`, never a crash.
function deadCodePath(f) {
  if (typeof f?.path === "string") return f.path;
  if (typeof f?.from_path === "string") return f.from_path;
  if (Array.isArray(f?.locations) && typeof f.locations[0]?.path === "string")
    return f.locations[0].path;
  if (Array.isArray(f?.imported_from) && typeof f.imported_from[0]?.path === "string")
    return f.imported_from[0].path;
  return "(unknown)";
}

// The salient name a dead-code finding carries, for the candidate's detail. The member categories
// carry a parent and a member; the rest carry one name field. A finding with none is blank.
function deadCodeDetail(f) {
  if (typeof f?.parent_name === "string" && typeof f?.member_name === "string") {
    return `${f.parent_name}.${f.member_name}`;
  }
  for (const key of [
    "export_name",
    "package_name",
    "member_name",
    "specifier",
    "component_name",
    "prop_name",
    "emit_name",
    "input_name",
    "output_name",
    "event_name",
    "action_name",
    "key_name",
    "callee",
    "name",
  ]) {
    if (typeof f?.[key] === "string") return f[key];
  }
  return "";
}

// fallow's `dead-code --format json` capture: the per-category finding arrays. Every category is a
// list of findings; `total_issues` is the count across all of them. The envelope's other keys
// (`kind`, `summary`, `entry_points`, …) are not lists, and `next_steps` is a list of advice
// objects, not findings — both are skipped. The categories are read from the artifact's own keys,
// because a framework category (`unused_store_members`, …) is omitted entirely when it is empty.
const DEAD_CODE_NON_CATEGORIES = new Set(["next_steps"]);

export function readFallowDeadCode(doc) {
  const categories = [];
  for (const [category, list] of Object.entries(doc ?? {})) {
    if (DEAD_CODE_NON_CATEGORIES.has(category) || !Array.isArray(list)) continue;
    categories.push({
      category,
      findings: list.map((f) => ({ detail: deadCodeDetail(f), path: deadCodePath(f) })),
    });
  }
  return { categories, total: typeof doc?.total_issues === "number" ? doc.total_issues : null };
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

// Whether a mutation file breaches its recorded floor: the per-file floor when the baseline records
// one, else the global floor (a new file gets the project's global floor, #62). The level is the
// file's `{ killed, total }`; a file with no recorded floor is not marked.
function mutationBelowFloor(level, file, baseline) {
  const mut = baseline?.gates?.mutation;
  if (!mut) return false;
  const floor = mut.files?.[file] ?? mut.global;
  if (!floor) return false;
  return !atLeast(level, floor);
}

// fallow's dead-code floor: `.fallow-dead-code-baseline.json`, a per-category list of the known
// findings. The floor for a category is the length of its list — the number of findings fallow
// already knows about. The file is fallow's own, separate from `.code-quality-baseline.json`
// (fallow's floors stay in fallow's own files, #77). A missing or malformed file is no floor.
function readDeadCodeFloor(root) {
  const path = join(root, DEAD_CODE_BASELINE_NAME);
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    const floor = {};
    for (const [category, list] of Object.entries(doc ?? {})) {
      if (Array.isArray(list)) floor[category] = list.length;
    }
    return floor;
  } catch {
    return null;
  }
}

// The total dead-code floor: the sum of the per-category floors, for the source line's summary.
function deadCodeFloorTotal(floor) {
  if (!floor) return null;
  return Object.values(floor).reduce((n, c) => n + c, 0);
}

// ---------------------------------------------------------------------------
// The library — the practice behind a gate
// ---------------------------------------------------------------------------

// The path the setup skill's `practice-delivery` recipe writes a practice doc to, relative to the
// project root. A candidate's pointer is this path with the practice's id.
const PRACTICE_DOC_DIR = "docs/code-quality/practices";

// The library directory to read practices and recipes from: `--library <path>`, else
// $CODE_QUALITY_LIBRARY, else the repo-layout default. Resolved to an absolute path so a relative
// flag reads from the cwd — the same resolution the setup skill's scripts use.
function resolveLibraryDir(flag) {
  return resolve(flag ?? process.env.CODE_QUALITY_LIBRARY ?? DEFAULT_LIBRARY_DIR);
}

// The strict-subset frontmatter reader (RECIPE-CONTRACT.md → "Reader rules"): scalars, block maps,
// block sequences of maps, and flow lists/maps. The same subset the setup skill's `frontmatter.mjs`
// parses, so a library the detector accepts is read here too. It is this skill's own copy, not an
// import from the sibling — the skills CLI copies one skill directory per install, so a relative
// import across skill directories would not resolve in a consumer's project (the same reason the
// artifact readers above are this skill's own). It is a reader for that subset, not a YAML parser.

// Flow-style values are JSON with the quotes left off. Quote the bare tokens, then JSON.parse.
function parseFlow(src) {
  const quoted = src
    .replace(/([{,]\s*)([A-Za-z_][\w.-]*)\s*:/g, '$1"$2":')
    .replace(/:\s*([^"'\s,[\]{}][^,}\]]*?)\s*(?=[,}])/g, (_m, w) => `: ${JSON.stringify(w)}`)
    .replace(
      /([[,]\s*)([^"'\s,[\]{}][^,}\]]*?)\s*(?=[,\]])/g,
      (_m, p, w) => `${p}${JSON.stringify(w)}`,
    );
  try {
    return JSON.parse(quoted);
  } catch (err) {
    throw new Error(`frontmatter: unreadable flow value ${JSON.stringify(src)} — ${err.message}`);
  }
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (s.startsWith("[") || s.startsWith("{")) return parseFlow(s);
  return s;
}

function parseFrontmatter(text, label) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) throw new Error(`${label}: no --- frontmatter block`);
  const lines = m[1].split(/\r?\n/);
  const indentOf = (l) => l.match(/^ */)[0].length;
  let i = 0;

  const skipBlank = () => {
    while (i < lines.length && lines[i].trim() === "") i++;
  };

  function parseNode(minIndent) {
    skipBlank();
    if (i >= lines.length) return null;
    const ind = indentOf(lines[i]);
    if (ind < minIndent) return null;
    return /^\s*-\s/.test(lines[i]) ? parseSeq(ind) : parseMap(ind);
  }

  function parseSeq(indent) {
    const out = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        i++;
        continue;
      }
      if (indentOf(line) !== indent || !/^\s*-\s/.test(line)) break;
      const rest = line.slice(indent + 1).trim();
      if (rest === "") {
        i++;
        out.push(parseNode(indent + 1));
        continue;
      }
      if (/^[A-Za-z_][\w-]*\s*:/.test(rest)) {
        // "- key: value" — the map's own lines sit two columns deeper.
        lines[i] = " ".repeat(indent + 2) + rest;
        out.push(parseMap(indent + 2));
        continue;
      }
      out.push(parseScalar(rest));
      i++;
    }
    return out;
  }

  function parseMap(indent) {
    const out = {};
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        i++;
        continue;
      }
      if (indentOf(line) !== indent) break;
      const mm = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
      if (!mm) throw new Error(`${label}: line outside the strict subset: ${JSON.stringify(line)}`);
      const [, key, rawVal] = mm;
      if (rawVal.trim() === "") {
        i++;
        out[key] = parseNode(indent + 1);
      } else {
        out[key] = parseScalar(rawVal);
        i++;
      }
    }
    return out;
  }

  const root = parseMap(0);
  skipBlank();
  if (i < lines.length) {
    throw new Error(`${label}: line outside the strict subset: ${JSON.stringify(lines[i])}`);
  }
  return root;
}

// The frontmatter of every `<dir>/*.md`, as `{ fm, id }`. A missing directory is an empty list; a
// file whose frontmatter does not parse is skipped, never fatal — the pointer is a convenience, and
// a malformed library must not crash the ranking. The id is the frontmatter's, falling back to the
// filename stem (the contract requires the two to be equal).
function readFrontmatterDir(dir) {
  if (!isDir(dir)) return [];
  const out = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  for (const file of files) {
    const stem = basename(file, ".md");
    const label = `${basename(dir)}/${file}`;
    try {
      const fm = parseFrontmatter(readFileSync(join(dir, file), "utf8"), label);
      out.push({ fm, id: typeof fm.id === "string" && fm.id ? fm.id : stem });
    } catch {
      // A malformed file is skipped: the ranking still prints, without that pointer.
    }
  }
  return out;
}

// The library's practices and recipes, frontmatter only. `null` when the library directory is
// absent — the pointer is then omitted, never a crash.
function loadLibrary(dir) {
  if (!isDir(dir)) return null;
  return {
    practices: readFrontmatterDir(join(dir, "practices")),
    recipes: readFrontmatterDir(join(dir, "recipes")),
  };
}

// gate → the practice doc pointers that cover it. A recipe declares a gate when one of its
// `gates[]` entries names it in `floor`: the six unified gates are exactly the `floor` vocabulary
// (RECIPE-CONTRACT.md → "`floor` — the gate's ratchet"), and a gate with no `floor` is a wall at a
// fixed level, not one of the ranked gates. A practice covers a gate when its `enforcedBy` names
// such a recipe. Several practices can cover one gate — a dozen ride the oxlint recipes' `lint`
// gate — so the value is a sorted list of pointers.
function practicePointers(library) {
  const byGate = new Map();
  if (!library) return byGate;
  const recipesByGate = new Map();
  for (const { fm, id } of library.recipes) {
    for (const gate of Array.isArray(fm.gates) ? fm.gates : []) {
      const floor = gate?.floor;
      if (typeof floor !== "string") continue;
      if (!recipesByGate.has(floor)) recipesByGate.set(floor, new Set());
      recipesByGate.get(floor).add(id);
    }
  }
  for (const { fm, id } of library.practices) {
    for (const recipe of Array.isArray(fm.enforcedBy) ? fm.enforcedBy : []) {
      for (const [gate, recipes] of recipesByGate) {
        if (!recipes.has(recipe)) continue;
        if (!byGate.has(gate)) byGate.set(gate, new Set());
        byGate.get(gate).add(`${PRACTICE_DOC_DIR}/${id}.md`);
      }
    }
  }
  const sorted = new Map();
  for (const [gate, pointers] of byGate) sorted.set(gate, [...pointers].sort());
  return sorted;
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

// The effort tier a target sorts in. The folded-in candidates are repo-owned — the artifact already
// exists and the fix needs no new harness — so they lead (tier 0). fallow's targets follow by their
// own `effort` estimate; a capture that carried no effort sorts last.
function effortTier(t) {
  if (t.source !== "fallow") return 0;
  return EFFORT_TIER[t.effort] ?? 4;
}

function confidenceRank(t) {
  return CONFIDENCE_RANK[t.confidence] ?? 3;
}

// The ranking: effort tier first (cheap first), then the source's own order — fallow's efficiency
// (priority ÷ effort) descending with confidence as the tiebreaker, the folded-in groups in their
// documented order. The sort is stable, so a pair that compares equal keeps its push order: the
// folded-in groups are already severity-ordered, and fallow's targets are already in fallow's own
// order. fallow's own rank is printed on every fallow line, so its ranking is not dropped.
function compareTargets(a, b) {
  const tier = effortTier(a) - effortTier(b);
  if (tier !== 0) return tier;
  if (a.source === "fallow") {
    const eff = (b.efficiency ?? b.priority ?? 0) - (a.efficiency ?? a.priority ?? 0);
    if (eff !== 0) return eff;
    return confidenceRank(a) - confidenceRank(b);
  }
  return (GROUP_ORDER[a.source] ?? 9) - (GROUP_ORDER[b.source] ?? 9);
}

// Read every artifact that exists and build the ranked target list. A missing artifact is a gap
// (with its capture command), never a crash; a malformed one is a gap too. `library` is the loaded
// library (or `null`); it only adds each target's practice pointers.
export function collect(root, bases, library = null) {
  const sources = {};
  const gaps = [];
  const targets = [];

  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

  // baseline — the recorded floors, read for the `below floor` marks and the lint/typecheck floors
  const baselinePath = join(root, BASELINE_NAME);
  const baseline = readBaseline(baselinePath);
  sources.baseline = {
    error: baseline.error,
    path: BASELINE_NAME,
    present: Boolean(baseline.doc),
    schemaVersion: baseline.doc?.schemaVersion ?? null,
  };
  if (baseline.error) {
    gaps.push({ path: BASELINE_NAME, reason: `unreadable: ${baseline.error}`, source: "baseline" });
  } else if (!baseline.doc) {
    gaps.push({
      path: BASELINE_NAME,
      reason: "absent — the setup skill's apply (or `score.mjs --raise`) records one",
      source: "baseline",
    });
  }

  // fallow targets — the structured ranking
  const fallowPath = join(root, ARTIFACTS.fallowTargets);
  if (existsSync(fallowPath)) {
    try {
      const list = readFallowTargets(readJson(fallowPath));
      sources.fallow = {
        count: list.length,
        error: null,
        path: ARTIFACTS.fallowTargets,
        present: true,
      };
      list.forEach((t, i) => {
        targets.push({
          actions: Array.isArray(t?.actions) ? t.actions : [],
          category: t?.category ?? null,
          confidence: t?.confidence ?? null,
          detail: typeof t?.recommendation === "string" ? t.recommendation : "",
          efficiency: t?.efficiency ?? null,
          effort: t?.effort ?? null,
          evidence: t?.evidence ?? null,
          factors: Array.isArray(t?.factors) ? t.factors : [],
          // fallow's own rank, so its ranking stays visible after the effort-tier reorder.
          fallowRank: i + 1,
          gate: t?.category === "remove_dead_code" ? "fallow-dead-code" : "fallow-health",
          path: typeof t?.path === "string" ? t.path : "(unknown)",
          priority: t?.priority ?? null,
          source: "fallow",
        });
      });
    } catch (err) {
      sources.fallow = {
        count: 0,
        error: String(err?.message ?? err),
        path: ARTIFACTS.fallowTargets,
        present: true,
      };
      gaps.push({
        path: ARTIFACTS.fallowTargets,
        reason: `unreadable: ${err?.message ?? err}`,
        source: "fallow",
      });
    }
  } else {
    sources.fallow = { count: 0, error: null, path: ARTIFACTS.fallowTargets, present: false };
    gaps.push({
      path: ARTIFACTS.fallowTargets,
      reason: `absent — capture it with \`${CAPTURE.fallowTargets}\``,
      source: "fallow",
    });
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
      gaps.push({
        path: ARTIFACTS.lcov,
        reason: `unreadable: ${err?.message ?? err}`,
        source: "coverage",
      });
    }
  } else if (existsSync(istanbulPath)) {
    covPath = ARTIFACTS.istanbul;
    covSource = "istanbul";
    try {
      covFiles = readIstanbul(readJson(istanbulPath), bases);
    } catch (err) {
      gaps.push({
        path: ARTIFACTS.istanbul,
        reason: `unreadable: ${err?.message ?? err}`,
        source: "coverage",
      });
    }
  }
  if (covFiles) {
    const rows = Object.entries(covFiles)
      .map(([file, metrics]) => ({ file, metrics, uncovered: uncoveredOf(metrics) }))
      .filter((r) => r.uncovered > 0)
      .sort((a, b) => b.uncovered - a.uncovered || a.file.localeCompare(b.file));
    sources.coverage = {
      error: null,
      files: rows.length,
      path: covPath,
      present: true,
      source: covSource,
    };
    for (const r of rows) {
      targets.push({
        belowFloor: coverageBelowFloor(r.metrics, r.file, baseline.doc),
        confidence: null,
        detail: `${r.uncovered} uncovered`,
        effort: null,
        gate: "coverage",
        metrics: r.metrics,
        path: r.file,
        source: "coverage",
        uncovered: r.uncovered,
      });
    }
  } else {
    sources.coverage = { error: null, files: 0, path: covPath, present: false, source: null };
    gaps.push({
      path: covPath,
      reason: `absent — capture it with \`${CAPTURE.lcov}\` (bun) or \`${CAPTURE.istanbul}\` (vitest)`,
      source: "coverage",
    });
  }

  // mutation — Stryker's report: the mutants the suite did not kill
  const mutationPath = join(root, ARTIFACTS.mutation);
  if (existsSync(mutationPath)) {
    try {
      const files = readMutation(readJson(mutationPath));
      const rows = Object.entries(files)
        .filter(([, f]) => f.gaps.length > 0)
        .sort((a, b) => b[1].gaps.length - a[1].gaps.length || a[0].localeCompare(b[0]));
      const gapCount = rows.reduce((n, [, f]) => n + f.gaps.length, 0);
      sources.mutation = {
        error: null,
        files: rows.length,
        gaps: gapCount,
        path: ARTIFACTS.mutation,
        present: true,
      };
      for (const [file, f] of rows) {
        const belowFloor = mutationBelowFloor(f, file, baseline.doc);
        for (const g of f.gaps) {
          targets.push({
            belowFloor,
            confidence: null,
            detail: `${g.status} ${g.mutatorName ?? "mutant"}`,
            effort: null,
            gate: "mutation",
            line: g.line,
            mutatorName: g.mutatorName,
            path: file,
            source: "mutation",
            status: g.status,
          });
        }
      }
    } catch (err) {
      sources.mutation = {
        error: String(err?.message ?? err),
        files: 0,
        gaps: 0,
        path: ARTIFACTS.mutation,
        present: true,
      };
      gaps.push({
        path: ARTIFACTS.mutation,
        reason: `unreadable: ${err?.message ?? err}`,
        source: "mutation",
      });
    }
  } else {
    sources.mutation = { error: null, files: 0, gaps: 0, path: ARTIFACTS.mutation, present: false };
    gaps.push({
      path: ARTIFACTS.mutation,
      reason: `absent — capture it with \`${CAPTURE.mutation}\``,
      source: "mutation",
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
        count,
        error: null,
        files: rows.length,
        floor: typeof floor === "number" ? floor : null,
        path: ARTIFACTS.oxlint,
        present: true,
      };
      for (const [file, c] of rows) {
        targets.push({
          confidence: null,
          count: c,
          detail: `${c} diagnostic(s)`,
          effort: null,
          gate: "lint",
          path: file,
          source: "lint",
        });
      }
    } catch (err) {
      sources.lint = {
        count: 0,
        error: String(err?.message ?? err),
        files: 0,
        floor: null,
        path: ARTIFACTS.oxlint,
        present: true,
      };
      gaps.push({
        path: ARTIFACTS.oxlint,
        reason: `unreadable: ${err?.message ?? err}`,
        source: "lint",
      });
    }
  } else {
    sources.lint = {
      count: 0,
      error: null,
      files: 0,
      floor: null,
      path: ARTIFACTS.oxlint,
      present: false,
    };
    gaps.push({
      path: ARTIFACTS.oxlint,
      reason: `absent — capture it with \`${CAPTURE.oxlint}\``,
      source: "lint",
    });
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
        count,
        error: null,
        files: rows.length,
        floor: typeof floor === "number" ? floor : null,
        path: ARTIFACTS.tsc,
        present: true,
      };
      for (const [file, c] of rows) {
        targets.push({
          confidence: null,
          count: c,
          detail: `${c} error(s)`,
          effort: null,
          gate: "typecheck",
          path: file,
          source: "typecheck",
        });
      }
    } catch (err) {
      sources.typecheck = {
        count: 0,
        error: String(err?.message ?? err),
        files: 0,
        floor: null,
        path: ARTIFACTS.tsc,
        present: true,
      };
      gaps.push({
        path: ARTIFACTS.tsc,
        reason: `unreadable: ${err?.message ?? err}`,
        source: "typecheck",
      });
    }
  } else {
    sources.typecheck = {
      count: 0,
      error: null,
      files: 0,
      floor: null,
      path: ARTIFACTS.tsc,
      present: false,
    };
    gaps.push({
      path: ARTIFACTS.tsc,
      reason: `absent — capture it with \`${CAPTURE.tsc}\``,
      source: "typecheck",
    });
  }

  // dead-code — fallow's per-category finding lists, floored by fallow's own baseline
  const deadPath = join(root, ARTIFACTS.deadCode);
  if (existsSync(deadPath)) {
    try {
      const { total, categories } = readFallowDeadCode(readJson(deadPath));
      const floor = readDeadCodeFloor(root);
      const files = new Set();
      let count = 0;
      for (const { category, findings } of categories) {
        // The floor is per category: the length of the baseline's list for that category. A
        // category with more findings than its floor carries new ones. The ranking cannot tell
        // which of the category's findings are the new ones without replicating fallow's own key
        // scheme (legacy forms or the `dc1` canonical keys), so every finding in an over-floor
        // category is marked — the same count-floor semantics lint and typecheck use. No baseline
        // is no floor: nothing is marked, as with the other gates.
        const aboveFloor = floor != null && findings.length > (floor[category] ?? 0);
        for (const f of findings) {
          files.add(f.path);
          count += 1;
          targets.push({
            aboveFloor,
            category,
            confidence: null,
            detail: f.detail,
            effort: null,
            gate: "fallow-dead-code",
            path: f.path,
            source: "dead-code",
          });
        }
      }
      sources["dead-code"] = {
        count: total ?? count,
        error: null,
        files: files.size,
        floor: deadCodeFloorTotal(floor),
        path: ARTIFACTS.deadCode,
        present: true,
      };
    } catch (err) {
      sources["dead-code"] = {
        count: 0,
        error: String(err?.message ?? err),
        files: 0,
        floor: null,
        path: ARTIFACTS.deadCode,
        present: true,
      };
      gaps.push({
        path: ARTIFACTS.deadCode,
        reason: `unreadable: ${err?.message ?? err}`,
        source: "dead-code",
      });
    }
  } else {
    sources["dead-code"] = {
      count: 0,
      error: null,
      files: 0,
      floor: null,
      path: ARTIFACTS.deadCode,
      present: false,
    };
    gaps.push({
      path: ARTIFACTS.deadCode,
      reason: `absent — capture it with \`${CAPTURE.deadCode}\``,
      source: "dead-code",
    });
  }

  // The rank: effort tier first (cheap first), then the source's own order — see compareTargets.
  targets.sort(compareTargets);
  const pointers = practicePointers(library);
  targets.forEach((t, i) => {
    t.rank = i + 1;
    t.raise = raiseCommand(t.gate, root);
    // The practice docs that cover this candidate's gate — `[]` with no library, or no match.
    t.practices = pointers.get(t.gate) ?? [];
  });

  return { gaps, sources, targets };
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
    case "mutation":
      return `  ${label}${s.path} — ${s.gaps} gap(s) in ${s.files} file(s)`;
    case "lint": {
      const floor =
        s.floor == null ? "" : `   floor ${s.floor}${s.count > s.floor ? "   ⚠ above floor" : ""}`;
      return `  ${label}${s.path} — ${s.count} diagnostic(s) in ${s.files} file(s)${floor}`;
    }
    case "typecheck": {
      const floor =
        s.floor == null ? "" : `   floor ${s.floor}${s.count > s.floor ? "   ⚠ above floor" : ""}`;
      return `  ${label}${s.path} — ${s.count} error(s) in ${s.files} file(s)${floor}`;
    }
    case "dead-code": {
      const floor =
        s.floor == null ? "" : `   floor ${s.floor}${s.count > s.floor ? "   ⚠ above floor" : ""}`;
      return `  ${label}${s.path} — ${s.count} issue(s) in ${s.files} file(s)${floor}`;
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
  if (Array.isArray(ev.unused_exports) && ev.unused_exports.length)
    parts.push(`unused_exports ${ev.unused_exports.length}`);
  if (Array.isArray(ev.complex_functions) && ev.complex_functions.length)
    parts.push(`complex_functions ${ev.complex_functions.length}`);
  if (Array.isArray(ev.cycle_path) && ev.cycle_path.length)
    parts.push(`cycle_path ${ev.cycle_path.length}`);
  if (Array.isArray(ev.direct_callers) && ev.direct_callers.length)
    parts.push(`direct_callers ${ev.direct_callers.length}`);
  if (Array.isArray(ev.clone_siblings) && ev.clone_siblings.length)
    parts.push(`clone_siblings ${ev.clone_siblings.length}`);
  return parts.length ? parts.join("; ") : null;
}

// Every candidate prints its effort and confidence; `—` where the source carries none (the
// folded-in candidates: coverage, mutation, lint, typecheck).
function effortConfidence(t) {
  return `effort ${t.effort ?? "—"}  confidence ${t.confidence ?? "—"}`;
}

function targetLines(t) {
  const lines = [];
  if (t.source === "fallow") {
    lines.push(
      `  ${t.rank}. [fallow] ${t.path}   priority ${t.priority ?? "—"}  efficiency ${t.efficiency ?? "—"}  ` +
        `${effortConfidence(t)}   fallow #${t.fallowRank}`,
    );
    if (t.detail) lines.push(`     ${t.category} — ${t.detail}`);
    if (t.factors.length) lines.push(`     factors: ${t.factors.map(factorText).join("; ")}`);
    const ev = evidenceText(t.evidence);
    if (ev) lines.push(`     evidence: ${ev}`);
    if (t.actions.length)
      lines.push(
        `     actions: ${t.actions
          .map((a) => a?.type)
          .filter(Boolean)
          .join("; ")}`,
      );
  } else if (t.source === "coverage") {
    const mark = t.belowFloor ? "   ⚠ below floor" : "";
    lines.push(
      `  ${t.rank}. [coverage] ${t.path}   ${coverageText(t.metrics)}   uncovered ${t.uncovered}   ` +
        `${effortConfidence(t)}${mark}`,
    );
  } else if (t.source === "mutation") {
    const mark = t.belowFloor ? "   ⚠ below floor" : "";
    const loc = t.line == null ? t.path : `${t.path}:${t.line}`;
    lines.push(`  ${t.rank}. [mutation] ${loc}   ${t.detail}   ${effortConfidence(t)}${mark}`);
  } else if (t.source === "dead-code") {
    const mark = t.aboveFloor ? "   ⚠ above floor" : "";
    const detail = t.detail ? ` — ${t.detail}` : "";
    lines.push(
      `  ${t.rank}. [dead-code] ${t.path}   ${t.category}${detail}   ${effortConfidence(t)}${mark}`,
    );
  } else {
    lines.push(`  ${t.rank}. [${t.source}] ${t.path}   ${t.detail}   ${effortConfidence(t)}`);
  }
  for (const p of t.practices ?? []) lines.push(`     practice: ${p}`);
  lines.push(`     raise: ${t.raise}`);
  return lines;
}

function renderText(report) {
  const lines = [];
  lines.push(`Improvement targets — ${report.root}`);
  lines.push("");
  for (const name of [
    "baseline",
    "fallow",
    "coverage",
    "mutation",
    "lint",
    "typecheck",
    "dead-code",
  ]) {
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
  const libIdx = args.indexOf("--library");
  let libraryFlag = null;
  if (libIdx !== -1) {
    libraryFlag = args[libIdx + 1];
    if (libraryFlag === undefined) throw new Error("--library needs a path");
  }
  // Drop `--library` and its value so the value is never mistaken for the project dir.
  const rest = libIdx === -1 ? args : args.filter((_, i) => i !== libIdx && i !== libIdx + 1);
  const target = rest.find((a) => !a.startsWith("--")) ?? ".";
  const root = resolve(target);
  if (!isDir(root)) {
    process.stderr.write(`rank: not a directory: ${target}\n`);
    process.exit(1);
  }

  const library = loadLibrary(resolveLibraryDir(libraryFlag));
  const bases = [root, safeRealpath(root)];
  const { sources, gaps, targets } = collect(root, bases, library);
  const report = { gaps, root, schemaVersion: SCHEMA_VERSION, sources, targets };

  process.stdout.write(json ? canonicalJson(report) : `${renderText(report)}\n`);
  process.exit(0);
}

// Run only when executed directly, so an import does not run the view.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`rank: ${err?.message ?? err}\n`);
    process.exit(1);
  }
}
