#!/usr/bin/env node

// plan.mjs — the code-quality-setup plan renderer.
//
// Zero dependencies, node builtins only. Runs the detector (detect.mjs) and prints the plan the
// agent shows for approval: the stack, the selection, the applicability matrix, held-back recipes,
// collisions, every file to be written (with inline diffs for merge/patch/collision), the commands
// in order, the gates and verify left behind, and a warning per unreadable recipe. It never writes
// anything and never invokes a package manager.
//
// Usage: node scripts/plan.mjs [projectDir] [--library <path>] [--recipe <id>] [--force] [--diff [path]]
//
// The output shape is specified in PLAN-SCHEMA.md next to this file; the recipe frontmatter and the
// substitution keys it renders are specified in the library's RECIPE-CONTRACT.md
// (library/RECIPE-CONTRACT.md); the JSON it consumes is specified in DETECT-SCHEMA.md.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARTIFACTS, compare, measure, readBaseline, safeRealpath } from "./score.mjs";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The library lives at the repo root, two levels up from the skill dir (skills/code-quality-setup/).
// This is the repo-layout default; the fetched cache (fetch.mjs) supplies its `libraryDir` through
// `--library` or $CODE_QUALITY_LIBRARY instead.
const DEFAULT_LIBRARY_DIR = resolve(SKILL_DIR, "..", "..", "library");
const DETECT = join(SKILL_DIR, "scripts", "detect.mjs");

// The library directory to read recipes and templates from: `--library <path>`, else
// $CODE_QUALITY_LIBRARY, else the repo-layout default. Resolved to an absolute path so a relative
// flag reads from the cwd.
function resolveLibraryDir(flag) {
  return resolve(flag ?? process.env.CODE_QUALITY_LIBRARY ?? DEFAULT_LIBRARY_DIR);
}
const MANIFEST_NAME = ".code-quality.json";
const MANIFEST_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    check: false,
    diff: false,
    diffPath: null,
    force: false,
    library: null,
    projectDir: ".",
    recipe: null,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--library") {
      opts.library = argv[++i];
      if (opts.library === undefined) throw new Error("--library needs a path");
    } else if (a === "--recipe") {
      opts.recipe = argv[++i];
      if (opts.recipe === undefined) throw new Error("--recipe needs an id");
    } else if (a === "--check") {
      opts.check = true;
    } else if (a === "--force") {
      opts.force = true;
    } else if (a === "--diff") {
      opts.diff = true;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts.diffPath = next;
        i++;
      }
    } else if (a.startsWith("--")) {
      throw new Error(`unknown option: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length > 0) opts.projectDir = positional[0];
  return opts;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

function runDetector(projectDir, libraryDir) {
  const out = execFileSync(process.execPath, [DETECT, projectDir, "--library", libraryDir], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// Substitution (RECIPE-CONTRACT.md → Substitution)
// ---------------------------------------------------------------------------

function renderGatesTable(selected) {
  const rows = [];
  for (const r of selected) for (const g of r.gates ?? []) rows.push(g);
  if (rows.length === 0) return "_No gates wired._";
  const lines = ["| Gate | Command | What it checks |", "| --- | --- | --- |"];
  for (const g of rows) lines.push(`| \`${g.id}\` | \`${g.run}\` | ${g.description ?? ""} |`);
  return lines.join("\n");
}

function renderDetails(selected) {
  const parts = [];
  for (const r of selected) {
    const lines = [`### ${r.title}`, "", r.purpose, ""];
    if ((r.gates ?? []).length > 0) {
      lines.push("**Gates**", "");
      for (const g of r.gates) {
        lines.push(`- \`${g.id}\` — \`${g.run}\`${g.description ? `: ${g.description}` : ""}`);
      }
      lines.push("");
    }
    lines.push("**Undo**", "");
    for (const u of r.undo ?? []) lines.push(`- ${u}`);
    lines.push("");
    parts.push(lines.join("\n"));
  }
  return parts.join("\n").trimEnd();
}

// `{{plan.areas}}` — the AREA_CONFIGS literal, rendered already formatted (RECIPE-CONTRACT.md).
function renderAreas(workspace) {
  const entries = [["", "stryker.conf.mjs"]];
  for (const m of workspace.members) entries.push([`${m.path}/`, `${m.path}/stryker.conf.mjs`]);
  if (entries.length === 1) return `[["", "stryker.conf.mjs"]]`;
  const lines = entries.map(([prefix, config]) => `  ["${prefix}", "${config}"],`);
  return `[\n${lines.join("\n")}\n]`;
}

function substitute(text, { root, gates, details, areas }) {
  // Function replacements: a `$&`/`$1` in the rendered text must stay literal.
  return text
    .replaceAll("{{root}}", () => root)
    .replaceAll("{{plan.gates}}", () => gates)
    .replaceAll("{{plan.details}}", () => details)
    .replaceAll("{{plan.areas}}", () => areas);
}

// ---------------------------------------------------------------------------
// Scope resolution (RECIPE-CONTRACT.md → files)
// ---------------------------------------------------------------------------

// Resolve a recipe's `files[]` into concrete writes. A `member` entry collapses into a `root` entry
// on the same resolved path (a single workspace resolves both to the same directory); nothing is
// written twice. `{{root}}` is the member's path back to the workspace root, `.` for a root file.
function resolveWrites(recipe, workspace) {
  const writes = [];
  const seen = new Set();
  const add = (f, target, member, rootPrefix) => {
    if (seen.has(target)) return;
    seen.add(target);
    writes.push({
      action: f.action,
      member,
      memberMode: f.memberMode ?? "standalone",
      path: f.path,
      rootPrefix,
      scope: f.scope ?? "root",
      target,
      template: f.template,
    });
  };
  for (const f of recipe.files ?? []) {
    const scope = f.scope ?? "root";
    if (scope === "root" || scope === "both") add(f, f.path, null, ".");
  }
  for (const f of recipe.files ?? []) {
    const scope = f.scope ?? "root";
    if (scope !== "member" && scope !== "both") continue;
    if (workspace.members.length === 0) {
      add(f, f.path, null, ".");
    } else {
      for (const m of workspace.members) add(f, `${m.path}/${f.path}`, m.path, m.rootPrefix);
    }
  }
  return writes;
}

// Resolve a `commands`/`verify` scope to the directories the entry runs in (RECIPE-CONTRACT.md →
// Scope resolution). A single workspace has no members, so `member` and `each-member` collapse to
// one implicit member at the root — the same collapse `resolveWrites` makes for `files`. Without it
// an `each-member` entry would resolve to zero directories and run zero times, recording the recipe
// as applied without its gate ever executing (#33).
function resolveScopes(scope, workspace) {
  if (scope === "member" || scope === "each-member") {
    return workspace.members.length === 0 ? ["."] : workspace.members.map((m) => m.path);
  }
  return ["."];
}

function readTemplate(libraryDir, libraryRelPath) {
  return readFileSync(join(libraryDir, libraryRelPath), "utf8");
}

// Whether the project is a git repository with at least one commit. A gate whose base is the
// merge-base with the branch's upstream (fallow's `audit`) has no base to detect on a repo with no
// commits — `fallow audit` exits 2 with `could not detect base branch` — so the plan warns before
// the verify runs. `git rev-parse --verify HEAD` exits non-zero when HEAD is unborn (no commits) or
// the directory is not a repository at all; both are the same "no base" state for the gate.
function hasCommits(root) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: root,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

// The selected recipes whose verify depends on a git base: a `verify` entry that names the
// `fallow-audit` gate (the changeset gate, whose `fallow audit` command detects a base branch). The
// requirement is the recipe's, not the project's, so the warning is scoped to the recipes that
// carry it.
function gitBaseRecipes(selected) {
  return selected.filter((r) => (r.verify ?? []).some((v) => v.gate === "fallow-audit"));
}

// ---------------------------------------------------------------------------
// Merge ownership (RECIPE-CONTRACT.md → merge; #11 → the two kinds)
// ---------------------------------------------------------------------------

const MISSING = Symbol("missing");

function extractBlock(fileContent, recipeId) {
  const start = `code-quality:${recipeId}:start`;
  const end = `code-quality:${recipeId}:end`;
  const lines = fileContent.split("\n");
  const i = lines.findIndex((line) => line.includes(start));
  const j = lines.findIndex((line) => line.includes(end));
  if (i === -1 || j === -1 || j < i) return null;
  return lines.slice(i, j + 1).join("\n");
}

function mergeKind(entry, recipeId) {
  if (entry.content.includes(`code-quality:${recipeId}:start`)) return "markers";
  if (entry.path.endsWith(".json")) return "json";
  return "markers";
}

// A marker merge block whose own marker is absent may still be redundant: the target file already
// carries what the block contributes. This is the hand-set-up repo (#35) — the harness is there,
// the manifest is not, so the marker is absent and the block reads `new` while the file already
// runs the gate. Two signals, both requiring the WHOLE block to be present (a partial match is not
// a duplicate: repo-hygiene's `.gitignore` block adds `.npm/`, `dist/`, `*.tsbuildinfo`, `.env`,
// `.env.local` and `*.log`; a repo that already ignores `dist/` but not the rest is a partial
// match, so the block still applies):
//   - line presence: every non-blank payload line already appears in the file, compared after
//     normalizing whitespace (a hand-written hook aligns its `||` with spaces);
//   - command presence: the payload is a documentation section (it carries a heading) and every
//     gate command it names already appears in the file (a hand-written AGENTS.md documents the
//     same gates in a different shape — bullets and arrows, not the rendered table);
//   - equivalent command (#94): the payload's gate command is already run by the file under a
//     different command. A repo that wired the same gate itself — its own `scripts/biome-staged.ts`
//     behind `bun run biome:staged` — runs Biome's staged format, but the line is not the block's
//     line, so line presence misses it and the block would be appended, running the gate twice.
//     The block's gate command names a tool (`bunx @biomejs/biome check --staged …`); the file
//     already runs the gate when it names the same tool binary and the same mode word. Both must
//     match, so a repo that runs the tool in another mode (`biome:lint`) is not a duplicate.
// Returns a human-readable evidence string, or null when the block contributes something new.
function blockAlreadyPresent(existing, content, recipeId) {
  const norm = (s) => s.trim().replace(/\s+/g, " ");
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const payload = content
    .split("\n")
    .filter(
      (line) =>
        !line.includes(`code-quality:${recipeId}:start`) &&
        !line.includes(`code-quality:${recipeId}:end`),
    );
  const fileLines = new Set(existing.split("\n").map(norm));
  const significant = payload.map(norm).filter((l) => l !== "");
  if (significant.length > 0 && significant.every((l) => fileLines.has(l))) {
    return "every line already present";
  }
  if (payload.some((l) => /^#{1,6}\s/.test(l.trim()))) {
    const commands = [
      ...new Set(
        [...content.matchAll(/\b(?:bunx?|npm|pnpm|npx)\s+(?:run\s+)?([A-Za-z0-9:_@./-]+)/g)].map(
          (m) => m[1],
        ),
      ),
    ];
    if (
      commands.length > 0 &&
      commands.every((c) => new RegExp(`\\b${escapeRe(c)}\\b`).test(existing))
    ) {
      return `already documents: ${commands.join(", ")}`;
    }
  }
  const gate = payload.find(
    (l) =>
      !l.trim().startsWith("#") &&
      /\b(?:bunx?|npx|npm|pnpm)\s+(?:run\s+)?[A-Za-z0-9:_@./-]/.test(l),
  );
  if (gate) {
    const tool = /\b(?:bunx?|npx|npm|pnpm)\s+(?:run\s+)?([A-Za-z0-9:_@./-]+)/
      .exec(gate)[1]
      .split("/")
      .pop();
    const mode = /--([a-z][a-z-]*)/.exec(gate)?.[1];
    if (tool && mode) {
      // The file's own command tokens, each split into its `:`-separated segments and its last path
      // segment, so the mode word is matched against a command — not any comment that happens to
      // contain it (a hook with `bun run biome:lint` and a comment mentioning "staged" is not a
      // duplicate).
      const names = [
        ...existing.matchAll(/\b(?:bunx?|npx|npm|pnpm)\s+(?:run\s+)?([A-Za-z0-9:_@./-]+)/g),
      ].flatMap((m) => [m[1], ...m[1].split(":"), m[1].split("/").pop()]);
      if (names.includes(tool) && names.includes(mode)) {
        return `already runs ${tool} ${mode}`;
      }
    }
  }
  return null;
}

// A `patch` has no marker, so the recipe cannot own the whole file — it owns the keys its template
// declares, the after-state the recipe body states (#37). The plan reads them with a minimal
// line-based reader (the shape a config patch targets: `[section]` headers and `key = value`, with
// a multi-line array joined and comments stripped) and canonicalizes them to a sorted list: `path =
// <value>` for a scalar, `path` alone for a collection. A collection is the repo's to extend — the
// recipe body's `coveragePathIgnorePatterns` is the case, where the project adds its own patterns —
// so the recipe owns only its presence; a scalar is the recipe's to set, so its value is compared.
function stripConfigComment(line) {
  let basic = false;
  let literal = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (basic) {
      if (c === "\\") i++;
      else if (c === '"') basic = false;
    } else if (literal) {
      if (c === "'") literal = false;
    } else if (c === '"') basic = true;
    else if (c === "'") literal = true;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

// The bracket/brace depth of a value, ignoring brackets inside strings: a multi-line array is
// joined until the depth returns to zero.
function configDepth(value) {
  let depth = 0;
  let basic = false;
  let literal = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (basic) {
      if (c === "\\") i++;
      else if (c === '"') basic = false;
    } else if (literal) {
      if (c === "'") literal = false;
    } else if (c === '"') basic = true;
    else if (c === "'") literal = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
  }
  return depth;
}

// The keys a config declares, as a Map from dotted path to { value, collection }. Only the shapes a
// recipe template uses are read: `[section]` headers, `key = value` scalars, and arrays/inline
// tables (single- or multi-line). Anything else is ignored, not fatal.
function configPairs(text) {
  const pairs = new Map();
  let section = "";
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = stripConfigComment(lines[i]).trim();
    if (line === "") continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1].trim();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    while (configDepth(value) > 0 && i + 1 < lines.length) {
      i++;
      value += " " + stripConfigComment(lines[i]).trim();
    }
    const path = section ? `${section}.${key}` : key;
    pairs.set(path, {
      collection: value.startsWith("[") || value.startsWith("{"),
      value: value.replace(/\s+/g, " ").trim(),
    });
  }
  return pairs;
}

// The canonical owned content of a `patch`: the template's declared keys, sorted, each rendered as
// `path = <value>` for a scalar and `path` for a collection. `target` supplies the values; a key
// the target does not declare makes the whole thing null (the after-state does not hold), while a
// scalar whose value differs is returned as-is so the caller reads it as drift, not absence.
function patchOwned(template, target) {
  const tpl = configPairs(template);
  const tgt = configPairs(target);
  const lines = [];
  for (const path of [...tpl.keys()].sort()) {
    const t = tpl.get(path);
    const g = tgt.get(path);
    if (g === undefined) return null;
    lines.push(t.collection ? path : `${path} = ${g.value}`);
  }
  return lines.join("\n");
}

function currentOwned(entry, recipeId) {
  if (entry.action === "patch") return patchOwned(entry.content, entry.content);
  if (entry.action !== "merge") return entry.content;
  if (mergeKind(entry, recipeId) === "json") return JSON.stringify(JSON.parse(entry.content));
  return entry.content.replace(/\n+$/, "");
}

function pick(doc, frag) {
  if (frag === null || typeof frag !== "object" || Array.isArray(frag)) {
    if (doc === undefined) return MISSING;
    // A seeded array the repo extended is the template's value, not the repo's (#104): the recipe
    // owns the array's presence and its seeded elements, so the owned content is the template's
    // array and a re-run reads `intact` instead of `update` forever.
    return seededLeaf(frag, doc) ? frag : doc;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return MISSING;
  const out = {};
  for (const [key, value] of Object.entries(frag)) {
    if (!(key in doc)) return MISSING;
    const sub = pick(doc[key], value);
    if (sub === MISSING) return MISSING;
    out[key] = sub;
  }
  return out;
}

function ownedContent(fileContent, entry, recipeId) {
  if (fileContent === null || fileContent === undefined) return null;
  if (entry.action === "patch") return patchOwned(entry.content, fileContent);
  if (entry.action !== "merge") return fileContent;
  if (mergeKind(entry, recipeId) === "json") {
    let doc;
    try {
      doc = JSON.parse(fileContent);
    } catch {
      return null;
    }
    const picked = pick(doc, JSON.parse(entry.content));
    return picked === MISSING ? null : JSON.stringify(picked);
  }
  return extractBlock(fileContent, recipeId);
}

// The leaf paths a JSON merge would add (absent in `doc`) and change (present with a different
// value). A fragment can do both: one new key does not excuse a changed one.
function jsonMergeDelta(doc, frag) {
  const changed = [];
  const added = [];
  const walk = (f, d, prefix) => {
    for (const [key, value] of Object.entries(f)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const isObj = value !== null && typeof value === "object" && !Array.isArray(value);
      const dIsObj = d !== null && typeof d === "object" && !Array.isArray(d);
      if (isObj && dIsObj && key in d) {
        walk(value, d[key], path);
      } else if (!dIsObj || !(key in d)) {
        added.push(path);
      } else if (JSON.stringify(d[key]) !== JSON.stringify(value) && !seededLeaf(value, d[key])) {
        changed.push(path);
      }
    }
  };
  walk(frag, doc, "");
  return { added, changed };
}

// The subset of `frag` whose leaves already exist in `doc` — the recipe's owned content as it
// stands, for the inline diff. `undefined` when none of it is present.
function presentFragment(doc, frag) {
  if (frag === null || typeof frag !== "object" || Array.isArray(frag))
    return doc === undefined ? undefined : doc;
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return undefined;
  const out = {};
  for (const [key, value] of Object.entries(frag)) {
    if (!(key in doc)) continue;
    const sub = presentFragment(doc[key], value);
    if (sub !== undefined) out[key] = sub;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// Unified diff (dependency-free, line-based LCS)
// ---------------------------------------------------------------------------

function diffLines(a, b) {
  const aLines = a === "" ? [] : a.split("\n");
  const bLines = b === "" ? [] : b.split("\n");
  const n = aLines.length;
  const m = bLines.length;
  if (n * m > 4_000_000) {
    return [
      ...aLines.map((line) => ({ line, type: "-" })),
      ...bLines.map((line) => ({ line, type: "+" })),
    ];
  }
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ line: aLines[i], type: " " });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ line: aLines[i], type: "-" });
      i++;
    } else {
      out.push({ line: bLines[j], type: "+" });
      j++;
    }
  }
  while (i < n) out.push({ line: aLines[i++], type: "-" });
  while (j < m) out.push({ line: bLines[j++], type: "+" });
  return out;
}

function unifiedDiff(aText, bText, path) {
  const ops = diffLines(aText, bText);
  if (!ops.some((o) => o.type !== " ")) return "";
  let oldNo = 1;
  let newNo = 1;
  const annotated = ops.map((o) => {
    const rec = { ...o, newNo, oldNo };
    if (o.type !== "+") oldNo++;
    if (o.type !== "-") newNo++;
    return rec;
  });
  const changed = annotated.map((o, i) => (o.type !== " " ? i : -1)).filter((i) => i >= 0);
  const hunks = [];
  let s = Math.max(0, changed[0] - 3);
  let e = Math.min(annotated.length - 1, changed[0] + 3);
  for (const idx of changed) {
    if (idx - 3 <= e + 1) {
      e = Math.min(annotated.length - 1, idx + 3);
    } else {
      hunks.push([s, e]);
      s = Math.max(0, idx - 3);
      e = Math.min(annotated.length - 1, idx + 3);
    }
  }
  hunks.push([s, e]);
  const out = [`--- a/${path}`, `+++ b/${path}`];
  for (const [hs, he] of hunks) {
    const slice = annotated.slice(hs, he + 1);
    const oldStart = slice.find((o) => o.type !== "+")?.oldNo ?? 0;
    const newStart = slice.find((o) => o.type !== "-")?.newNo ?? 0;
    const oldCount = slice.filter((o) => o.type !== "+").length;
    const newCount = slice.filter((o) => o.type !== "-").length;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const o of slice) out.push(`${o.type}${o.line}`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Per-file verdicts
// ---------------------------------------------------------------------------

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// A JSON value that is a plain object (not null, not an array).
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Whether `repo` is a structural subset of `template`: every key/element the repo declares is
// declared by the template too, recursively. A scalar matches only itself. This is the "the repo
// element is present in the template" test for an array element (#44): a repo element the template
// covers is not lost, whether it is equal (no-op) or behind (drift).
function covers(template, repo) {
  if (isPlainObject(template) && isPlainObject(repo)) {
    return Object.entries(repo).every(
      ([key, value]) => Object.hasOwn(template, key) && covers(template[key], value),
    );
  }
  if (Array.isArray(template) && Array.isArray(repo)) {
    return repo.every((element) => template.some((candidate) => covers(candidate, element)));
  }
  return template === repo;
}

// A JSON leaf the template *seeds*: an array the repo may extend (#104). The repo's array covers
// the template's when every template element is present in it (the same `covers` test the
// create-loss comparison uses), so an extended array is not a change — the recipe owns the array's
// presence and its seeded elements, not the repo's additions. A scalar is the recipe's to set, so
// it is compared by value. This is the JSON-merge half of "the recipe owns the keys it declares,
// not the file": `tsconfig.json`'s `lib` is the case, where the repo adds `DOM`/`DOM.Iterable` and
// the merge must not propose dropping them.
function seededLeaf(templateValue, repoValue) {
  return (
    Array.isArray(templateValue) && Array.isArray(repoValue) && covers(repoValue, templateValue)
  );
}

// The paths where `repo` carries content `template` does not (#44). Objects recurse by key: a key
// the template lacks is lost whole, and a key present in both is compared deeper. Arrays compare by
// element, not by position: a repo element no template element covers is lost, so a reordered array
// is not a loss and an extended one is. A scalar, or a type mismatch, is never lost — a differing
// value is the library moving (a version bump, a changed default), which is drift, not the repo's
// content. `prefix` is the dotted path of the value being compared; an array element's path is
// `<array>[<canonical element>]`, so the lost item names the element, not a position. Only the
// topmost lost path is reported, so an extra subtree reads as one key, not one per descendant.
function lostPaths(repo, template, prefix) {
  if (isPlainObject(repo)) {
    const lost = [];
    for (const [key, value] of Object.entries(repo)) {
      const child = prefix ? `${prefix}.${key}` : key;
      if (!isPlainObject(template) || !Object.hasOwn(template, key)) lost.push(child);
      else lost.push(...lostPaths(value, template[key], child));
    }
    return lost;
  }
  if (Array.isArray(repo)) {
    if (!Array.isArray(template)) return [];
    const lost = [];
    for (const element of repo) {
      if (!template.some((candidate) => covers(candidate, element))) {
        lost.push(`${prefix}[${JSON.stringify(element)}]`);
      }
    }
    return lost;
  }
  return [];
}

// A `create` target the repo has customized (#36): the repo's file carries content the template
// does not, so overwriting it would drop that content. A `create` target has no marker, so the
// skill cannot tell "the repo added content" from "the repo is behind the library" by ownership;
// it compares content instead.
//
// For a JSON target the comparison is structural (#42, #44): a path the repo declares and the
// template does not is content the template lacks — the loss. A path present in both is not lost
// whatever its value: a differing value is the library moving (a version bump, a changed default),
// which is drift, not the repo's content. An array is compared by element, not as a leaf (#44): a
// repo element no template element covers is a loss, so a repo that extends an array is not
// overwritten. Only the topmost lost path is reported, so an extra subtree reads as one key, not
// one per descendant. For any other target it is line-based: a non-blank repo line absent from the
// template (after whitespace normalization, the same normalization `blockAlreadyPresent` uses) is
// content the template lacks. When nothing is lost the repo is a subset (behind), and the overwrite
// drops nothing. Returns the lost items and their unit (dotted paths for JSON, lines otherwise), or
// an empty list when none.
function lostContent(existing, content, target) {
  if (target.endsWith(".json")) {
    const repo = tryParseJson(existing);
    const template = tryParseJson(content);
    if (repo !== null && template !== null) {
      return { items: lostPaths(repo, template, ""), unit: "key" };
    }
  }
  const norm = (s) => s.trim().replace(/\s+/g, " ");
  const templateLines = new Set(content.split("\n").map(norm));
  return {
    items: existing
      .split("\n")
      .map(norm)
      .filter((line) => line !== "" && !templateLines.has(line)),
    unit: "line",
  };
}

// The "key" of a line: the text up to and including the first `:` or `=`, or the whole line when it
// declares neither. A config line's key is the ownership boundary — the recipe owns the key, the
// repo may change the value — the same boundary a `patch` draws (#37).
function lineKey(line) {
  const m = /^([^:=]*[:=])/.exec(line);
  return m ? m[1] : line;
}

// Whether a line is a comment (#167): a comment is not content — the recipe does not own it, and the
// repo's own comment is not an addition the overwrite would drop — so it is excluded before the key
// test below. The prefixes cover the languages the library's templates are written in: `//` for JS
// and TS, `#` for shell, YAML, TOML and gitignore (a shebang included), `/*` and `*` for a block
// comment and its continuation lines, `<!--` for Markdown and HTML.
function isCommentLine(line) {
  return /^(\/\/|#|\/\*|\*|<!--)/.test(line.trim());
}

// Whether every lost line sits at a key the template declares (#167): the line-based counterpart of
// the structural comparison `lostContent` already makes for a JSON target. A repo line whose key the
// template declares is the library's value moving — a version bump, a changed default, the library's
// own earlier render — not the repo's content; a repo line whose key the template does NOT declare
// is the repo's own addition. Comment lines are not content, so they are excluded first. `lost` is
// already whitespace-normalized by `lostContent`, so `lineKey` reads the same text the template's
// lines are normalized to.
function lostLinesAreTemplateKeys(content, lost) {
  const norm = (s) => s.trim().replace(/\s+/g, " ");
  const templateKeys = new Set(content.split("\n").map(norm).map(lineKey));
  return lost
    .filter((line) => !isCommentLine(line))
    .every((line) => templateKeys.has(lineKey(line)));
}

// Whether the repo's file carries the template's content (#103, #105): every non-blank template
// line is present in the repo's file, or the repo's file has a line that *extends* it — the same
// key, and every token of the template line present in that line. A template line the repo
// *deleted* is not carried: its tokens are gone. This is "the recipe owns the keys it declares, not
// the file" applied to a `create` target: a repo that extended a seeded value (an array element, a
// rewritten step) still carries the library's content, so a re-run reads `intact` instead of
// `update` forever (#105), and a file that is not the library's content plus additions — an earlier
// library version's template — is not read as the repo's own additions (#103).
//
// The token test is scoped to a repo line at the SAME key, not the whole file's token set (#168): a
// template line's trailing `{` is "present" in any file that uses braces elsewhere, so a repo line
// that is the template line minus the brace — the library's own earlier render — would read as
// carried, and the plan would tell the apply to merge a line that duplicates the statement. The key
// is the ownership boundary `lineKey` draws, so the comparison stays within the line the template
// owns: a repo line at the key that carries every template token extends it (the #90 merge); one
// that does not is the library's earlier render, and the caller's `olderRender` branch re-renders
// it instead. The tokens are not pooled across the repo's lines at the key — a sibling line at the
// same key must not supply a token the template line's own counterpart lacks.
//
// A JSON target is compared structurally, the same test `lostContent` uses: the template's paths
// must all be present in the repo's document (an array element the repo dropped is not carried).
function carriesTemplate(repoFile, template, target) {
  if (target.endsWith(".json")) {
    const repo = tryParseJson(repoFile);
    const tpl = tryParseJson(template);
    if (repo !== null && tpl !== null) return lostPaths(tpl, repo, "").length === 0;
  }
  const norm = (s) => s.trim().replace(/\s+/g, " ");
  const repoLines = repoFile.split("\n").map(norm);
  const repoSet = new Set(repoLines);
  const tokensByKey = new Map();
  for (const line of repoLines) {
    const key = lineKey(line);
    const tokens = new Set(line.split(/\s+/).filter((t) => t !== ""));
    const atKey = tokensByKey.get(key);
    if (atKey) atKey.push(tokens);
    else tokensByKey.set(key, [tokens]);
  }
  for (const raw of template.split("\n")) {
    const line = norm(raw);
    if (line === "") continue;
    if (repoSet.has(line)) continue;
    const atKey = tokensByKey.get(lineKey(line));
    if (atKey && atKey.some((tokens) => line.split(/\s+/).every((t) => tokens.has(t)))) continue;
    return false;
  }
  return true;
}

// Whether a `create` file's on-disk content is a loss (#36, #46): the repo's file carries content
// the template does not, so the apply skipped it. The manifest recorded the rendered template's
// hash — the apply records what it would have written, even for a skipped file — so the hash
// comparison alone reads `drifted`, as if the repo had hand-edited the skill's own bytes. It did
// not: the file is the repo's, the library has not moved, and the Files section already shows
// `loss`. The content comparison is what tells the two apart, so the drift report uses it too.
function isCreateLoss(f, files) {
  return (
    f.action === "create" &&
    files[f.path] != null &&
    lostContent(files[f.path], f.content, f.path).items.length > 0
  );
}

// Whether two texts differ only by formatting (#143, #153): a repo-wide formatter sweep
// (`dprint fmt`, `biome format --write`) rewrites the library's content — it re-aligns a table's
// columns, pads the separator row's dashes, adds or drops blank lines, and moves a line boundary
// (it wraps a long line, `a && b` → `a` / `&& b`, or joins two short ones) — without changing the
// content. The content still carries what the recipe owns, so the drift report reads `intact`, not
// `drifted`/`loss`; a hand-edit that changes the content still reads `drifted`/`loss`. The
// comparison normalizes each line's whitespace, drops blank lines, canonicalizes a Markdown table
// separator row (its dashes are alignment, not content), and joins the normalized lines, so
// alignment and reflow churn are invisible while any token change is not. It is used for a marker
// block the recipe owns (#143) and for a `create` file the recipe wrote (#153).
function formattingEquivalent(a, b) {
  const norm = (text) =>
    text
      .split("\n")
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter((line) => line !== "")
      .map((line) => {
        // A Markdown table separator row's dashes are alignment, not content.
        if (!/^\|[\s:|-]+\|$/.test(line)) return line;
        return line.replace(/\s+/g, "").replace(/-+/g, "-");
      })
      // Join the normalized lines: a formatter also moves a line boundary, so a line-by-line
      // comparison misses the reflow. The joined text is the token stream with single spaces, so
      // any token change still differs while a pure reflow does not.
      .join(" ");
  return norm(a) === norm(b);
}

// The verdict for one write, from the filesystem alone (no manifest): create → new/no-op/drift/
// update/loss, merge → new/no-op/add/replace/collision, patch → new/patch. `diff` is the inline
// unified diff. `manifestPresent` decides the `create` verdict for a file the repo has extended
// (#90): with a manifest the plan knows the repo's file is not the recorded content, so it is a
// `loss` (skip); without one the plan cannot tell the repo's own additions from the skill's own
// earlier install, so it is an `update` (merge — the library's content is written, the repo's
// additions are preserved). Without a manifest a `create` file that is the library's own earlier
// render is an `update` too (#167), but one the apply re-renders rather than merges: the lost items
// are the previous render's lines, not the repo's additions, so the row carries `olderRender` and
// the Updates section says not to re-apply them.
function filesystemVerdict(write, content, projectRoot, recipeId, manifestPresent) {
  const abs = join(projectRoot, write.target);
  const existing = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  const entry = { action: write.action, content, path: write.target };

  if (write.action === "create") {
    if (existing === null) return { diff: unifiedDiff("", content, write.target), verdict: "new" };
    if (existing === content) return { verdict: "no-op" };
    // A formatter-only rewrite of a file the recipe created (#153): a repo-wide sweep (`dprint
    // fmt`) reformats the template the apply wrote — it reflows lines and re-aligns whitespace —
    // without changing the content. The file still carries the recipe's content, so it is a
    // `no-op` (nothing to do), not a `loss` (the repo's extra content would be dropped) or a
    // `drift` (the library moved). A hand-edit that changes the content is not formatting-
    // equivalent, so it still reads `loss`/`drift`/`update` as before.
    if (formattingEquivalent(existing, content)) return { verdict: "no-op" };
    const { unit, items: lost } = lostContent(existing, content, write.target);
    if (lost.length > 0) {
      // No manifest (#90): the filesystem is the source of truth (ADR 0001), so the repo's file
      // is read as the skill's own earlier install plus the repo's additions — an `update` the
      // apply merges, not a `loss` it skips. The ratchet installs, and the additions survive.
      //
      // Only when the repo's file *carries the template's content* (#103): a file that is not the
      // library's content plus additions — an earlier library version's template, whose lines the
      // current template never had — is not the repo's own additions, so it is a `loss` (skip),
      // not an `update` (merge). Following the Updates section's instruction on such a file would
      // re-add the old template's lines and break the gate it installs. An earlier render whose
      // lines all sit at keys the current template declares is the next branch's case (#167): the
      // library's own value moved, so the apply re-renders the file instead of skipping it.
      if (!manifestPresent && carriesTemplate(existing, content, write.target)) {
        return {
          diff: unifiedDiff(existing, content, write.target),
          lost,
          note: `the repo's file carries ${lost.length} ${unit}(s) the template does not — merge them in, do not drop them`,
          unit,
          verdict: "update",
        };
      }
      // A `create` target whose repo file is the library's own EARLIER RENDER (#167): every lost
      // line sits at a key the template declares, so the lost content is the library's own earlier
      // value — a version bump, a changed default — not the repo's addition. This is the line-based
      // counterpart of the structural comparison the contract already states for a JSON target ("a
      // path present in both is not lost whatever its value, because a differing value is the
      // library moving ... which is drift, not the repo's content"): a repo line whose key the
      // template does NOT declare is the repo's own addition and stays a `loss`. Reading it as
      // `update` is what lets a library fix delivered through a `create` template reach a repo
      // migrated from an older library that never committed a manifest — the apply re-renders the
      // file instead of skipping it, so the fix lands (#167). A JSON target needs no such branch:
      // `lostPaths` already excludes a path present in both, so every lost path there is a
      // repo-only path — the repo's addition. `unit === "line"` is the line-based comparison (a
      // JSON target whose document does not parse falls back to it too).
      if (!manifestPresent && unit === "line" && lostLinesAreTemplateKeys(content, lost)) {
        return {
          diff: unifiedDiff(existing, content, write.target),
          lost,
          note: `the repo's file is an earlier render of the template — re-render it from the current library; the ${lost.length} ${unit}(s) below are the previous render's, not the repo's additions`,
          olderRender: true,
          unit,
          verdict: "update",
        };
      }
      return {
        diff: unifiedDiff(existing, content, write.target),
        lost,
        note: `the repo's file carries ${lost.length} ${unit}(s) the template does not — overwriting drops them`,
        unit,
        verdict: "loss",
      };
    }
    return { diff: unifiedDiff(existing, content, write.target), verdict: "drift" };
  }

  if (write.action === "merge") {
    if (mergeKind(entry, recipeId) === "json") {
      const frag = JSON.parse(content);
      if (existing === null)
        return {
          diff: unifiedDiff("", JSON.stringify(frag, null, 2), write.target),
          verdict: "new",
        };
      const doc = tryParseJson(existing);
      if (doc === null)
        return {
          diff: unifiedDiff(existing, content, write.target),
          note: "target is not valid JSON",
          verdict: "collision",
        };
      const { changed, added } = jsonMergeDelta(doc, frag);
      const present = presentFragment(doc, frag);
      const diff = unifiedDiff(
        present ? JSON.stringify(present, null, 2) : "",
        JSON.stringify(frag, null, 2),
        write.target,
      );
      if (changed.length > 0) {
        return { diff, note: `would change: ${changed.join(", ")}`, verdict: "collision" };
      }
      if (added.length > 0) {
        return { diff, note: `adds: ${added.join(", ")}`, verdict: "add" };
      }
      return { verdict: "no-op" };
    }
    const block = existing === null ? null : extractBlock(existing, recipeId);
    const target = content.replace(/\n+$/, "");
    if (block === null) {
      const evidence = existing === null ? null : blockAlreadyPresent(existing, content, recipeId);
      if (evidence !== null) {
        return {
          diff: unifiedDiff("", target, write.target),
          note: `already present — ${evidence}; skip this block`,
          verdict: "duplicate",
        };
      }
      return { diff: unifiedDiff("", target, write.target), verdict: "new" };
    }
    if (block === target) return { verdict: "no-op" };
    return { diff: unifiedDiff(block, target, write.target), verdict: "replace" };
  }

  if (write.action === "patch") {
    if (existing === null) return { note: "created from the template", verdict: "new" };
    // The after-state the recipe body states already holds (#37): the target declares every key the
    // template declares, with the template's scalar values. The patch is a no-op, so the plan says
    // so instead of showing the template as the target.
    if (patchOwned(content, existing) === patchOwned(content, content)) {
      return { note: "the after-state already holds", verdict: "no-op" };
    }
    return {
      diff: unifiedDiff(existing, content, write.target),
      note: "unverifiable — the recipe body states the before/after",
      verdict: "patch",
    };
  }

  return { verdict: "unknown" };
}

// ---------------------------------------------------------------------------
// Manifest / drift half (#11)
// ---------------------------------------------------------------------------

// 8-hex sha256. The manifest schema (#11) shows 8-hex hashes; the prototype used FNV-1a and noted
// the real implementation uses sha256. The apply step (agent-driven, no apply.mjs) must use the
// same function; it is documented in PLAN-SCHEMA.md.
function hash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

function readManifest(projectRoot) {
  const abs = join(projectRoot, MANIFEST_NAME);
  if (!existsSync(abs)) return { degraded: true, manifest: null, reason: "no manifest" };
  const parsed = tryParseJson(readFileSync(abs, "utf8"));
  if (parsed === null)
    return { degraded: true, manifest: null, reason: "manifest is not valid JSON" };
  if (parsed.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    return {
      degraded: true,
      manifest: null,
      reason: `manifest schemaVersion ${parsed.schemaVersion} ≠ ${MANIFEST_SCHEMA_VERSION}`,
    };
  }
  return { degraded: false, manifest: parsed, reason: null };
}

const RANK = { drifted: 3, intact: 1, loss: 4, missing: 5, update: 2 };

function rollUp(fileVerdicts) {
  let worst = "intact";
  for (const f of fileVerdicts) if (RANK[f.verdict] > RANK[worst]) worst = f.verdict;
  return worst;
}

// classify() from #11: the filesystem wins; the manifest supplies only "which bytes the skill wrote
// last time". `library` is the current selection's rendered files; `files` is the project's
// filesystem content by workspace-relative path.
function classify(manifest, { library, files }) {
  const recorded = new Map((manifest?.recipes ?? []).map((r) => [r.id, r]));
  const declined = new Set((manifest?.declined ?? []).map((d) => d.id));
  const known = new Set(library.map((r) => r.id));
  const recipes = [];

  for (const lib of library) {
    const rec = recorded.get(lib.id);
    if (!rec) {
      recipes.push({ files: [], id: lib.id, state: declined.has(lib.id) ? "declined" : "new" });
      continue;
    }
    const fileVerdicts = lib.files.map((f) => {
      const recFile = (rec.files ?? []).find((x) => x.path === f.path && x.action === f.action);
      const recordedHash = recFile ? recFile.hash : null;
      const currentHash = hash(currentOwned(f, lib.id));
      const present = ownedContent(files[f.path] ?? null, f, lib.id);
      const presentHash = present === null ? null : hash(present);
      // A marker block the file already carries without a marker (#35) is not `missing`: the
      // content is present, the recipe just does not own it. Treat it as intact so a re-run does
      // not reinstate a second block.
      const duplicate =
        present === null &&
        f.action === "merge" &&
        mergeKind(f, lib.id) === "markers" &&
        files[f.path] != null &&
        blockAlreadyPresent(files[f.path], f.content, lib.id) !== null;
      // A `create` target the repo has customized (#36, #46) reads `loss`, not `drifted`: the
      // manifest recorded the rendered template's hash, so the hash comparison alone cannot tell
      // the repo's own content from a hand-edit of the skill's. See `isCreateLoss`.
      // A `create` the apply left as a merge (#90): the apply wrote the library's content plus the
      // repo's additions and recorded the file it wrote, so the recorded hash matches the file and
      // the file still carries every path/line the current template owns. The recipe's owned
      // content is present — the extras are the repo's — so it is `intact`, not `update` (which
      // would overwrite the file with the bare template and drop the additions). An old manifest
      // recorded the bare template's hash, so `presentHash !== recordedHash` and this never fires.
      //
      // The same signature — the recorded hash matches the file, and the file is a superset of the
      // current render — is also produced by a library move whose render only REMOVES content
      // (#166): the file is the skill's own earlier render, and the removed content is the
      // library's, not the repo's. Hashes alone cannot tell the two apart, so the manifest's
      // per-file `renderHash` — the hash of the RENDERED template the apply wrote — is the
      // discriminator: it matches the current render only when the library has not moved. Absent
      // (every manifest written before the field existed) the branch behaves exactly as before, so
      // a #90 merge recorded by an old manifest still reads `intact`.
      const mergedCreate =
        f.action === "create" &&
        recordedHash !== null &&
        presentHash === recordedHash &&
        files[f.path] != null &&
        lostContent(f.content, files[f.path], f.path).items.length === 0 &&
        (recFile?.renderHash == null || recFile.renderHash === currentHash);
      // A formatter-only rewrite of a marker block the recipe owns (#143): a repo-wide formatter
      // sweep (`dprint fmt`) rewrote the block's whitespace/alignment, so the hash moved but the
      // content did not. The block still carries the owned content, so it is `intact`, not
      // `drifted` — otherwise a clean apply followed by the sweep's own `commands` entry can
      // never converge. A hand-edit that changes the content still reads `drifted` (see
      // `formattingEquivalent`). The `update` branch consults it too: a manifest recorded from the
      // file on disk (the swept block) rather than from the rendered template has
      // `presentHash === recordedHash` and would otherwise read `update` forever, so a
      // formatting-equivalent block is `intact` even then. A genuine library move — the render's
      // content changed — is not formatting-equivalent, so it still reads `update`.
      const formatted =
        f.action === "merge" &&
        mergeKind(f, lib.id) === "markers" &&
        present !== null &&
        formattingEquivalent(present, currentOwned(f, lib.id));
      // A formatter-only rewrite of a `create` file the recipe wrote (#153): a repo-wide sweep
      // (`dprint fmt`) reformats the template the apply wrote — it reflows lines and re-aligns
      // whitespace — without changing the content. The file still carries the recipe's content, so
      // it is `intact`, not `loss` (the repo's extra content would be dropped) or `drifted` (a
      // hand-edit). A hand-edit that changes the content is not formatting-equivalent, so it still
      // reads `loss`/`drifted`. The `update` branch consults it too: a manifest recorded from the
      // file on disk (the swept file) rather than from the rendered template has
      // `presentHash === recordedHash` and would otherwise read `update` forever.
      const formattedCreate =
        f.action === "create" &&
        present !== null &&
        formattingEquivalent(present, currentOwned(f, lib.id));
      let verdict;
      if (duplicate) verdict = "intact";
      else if (presentHash === null) verdict = "missing";
      else if (presentHash === currentHash) verdict = "intact";
      else if (mergedCreate) verdict = "intact";
      else if (
        recordedHash !== null &&
        presentHash === recordedHash &&
        !formatted &&
        !formattedCreate
      )
        verdict = "update";
      else if (formatted || formattedCreate) verdict = "intact";
      else if (isCreateLoss(f, files)) verdict = "loss";
      else verdict = "drifted";
      return {
        action: f.action,
        currentHash,
        kind: f.action === "merge" ? mergeKind(f, lib.id) : null,
        path: f.path,
        presentHash,
        recordedHash,
        renderHash: currentHash,
        updateAvailable:
          recordedHash !== null &&
          recordedHash !== currentHash &&
          !mergedCreate &&
          !formatted &&
          !formattedCreate,
        verdict,
      };
    });
    recipes.push({
      files: fileVerdicts,
      id: lib.id,
      recipeChanged: rec.recipeHash !== lib.hash,
      state: rollUp(fileVerdicts),
    });
  }

  for (const rec of manifest?.recipes ?? []) {
    if (!known.has(rec.id)) recipes.push({ files: [], id: rec.id, state: "stale" });
  }
  return { recipes };
}

// ---------------------------------------------------------------------------
// Plan assembly
// ---------------------------------------------------------------------------

function buildPlan(report, opts) {
  const { stack, recipes, selection, heldBack, collisions } = report;
  const libraryDir = resolveLibraryDir(opts.library);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const errored = recipes.filter((r) => r.error !== null);
  const usable = recipes.filter((r) => r.error === null);

  // --recipe narrows the selection to one id, without bypassing `when`.
  let selectedIds = selection;
  let narrowNote = null;
  if (opts.recipe !== null) {
    if (!byId.has(opts.recipe)) {
      narrowNote = `No recipe with id "${opts.recipe}".`;
      selectedIds = [];
    } else if (!selection.includes(opts.recipe)) {
      narrowNote = `Recipe "${opts.recipe}" is not selected — its \`when\` does not hold.`;
      selectedIds = [];
    } else {
      const r = byId.get(opts.recipe);
      const needsOther = (r.reasons ?? []).some(
        (x) => x.predicate.startsWith("requires {") && x.predicate.includes('"recipe"'),
      );
      if (needsOther) {
        narrowNote = `Recipe "${opts.recipe}" requires another recipe and will not apply alone.`;
        selectedIds = [];
      } else {
        selectedIds = [opts.recipe];
      }
    }
  }

  const selected = selectedIds.map((id) => byId.get(id)).filter(Boolean);

  // Substitution context, rendered from the whole selection.
  const subst = {
    areas: renderAreas(stack.workspace),
    details: renderDetails(selected),
    gates: renderGatesTable(selected),
  };

  // Concrete writes per selected recipe, with rendered content. A template the recipe names but
  // that is not on disk is reported, not fatal: the rest of the plan still renders.
  const writesByRecipe = new Map();
  const templateErrors = [];
  for (const r of selected) {
    const writes = [];
    for (const w of resolveWrites(r, stack.workspace)) {
      let content;
      try {
        content = substitute(readTemplate(r.libraryDir ?? libraryDir, w.template), {
          ...subst,
          root: w.rootPrefix,
        });
      } catch (err) {
        templateErrors.push({ error: `${w.template}: ${err.message}`, id: r.id });
        continue;
      }
      writes.push({ ...w, content, recipeId: r.id });
    }
    writesByRecipe.set(r.id, writes);
  }

  // Manifest / drift half.
  const { manifest, degraded, reason } = readManifest(report.root);
  const files = {};
  for (const r of selected) {
    for (const w of writesByRecipe.get(r.id)) {
      const abs = join(report.root, w.target);
      files[w.target] = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    }
  }
  const library = selected.map((r) => ({
    files: writesByRecipe
      .get(r.id)
      .map((w) => ({ action: w.action, content: w.content, path: w.target })),
    hash: hash(
      readFileSync(join(r.libraryDir ?? libraryDir, "recipes", `${r.id}.md`), "utf8") +
        writesByRecipe
          .get(r.id)
          .map((w) => w.content)
          .join("\n"),
    ),
    id: r.id,
  }));
  const drift = manifest ? classify(manifest, { files, library }) : null;
  const driftById = new Map((drift?.recipes ?? []).map((r) => [r.id, r]));

  // Per-write verdicts: manifest-aware when a manifest is present, filesystem-only otherwise.
  const fileRows = [];
  for (const r of selected) {
    for (const w of writesByRecipe.get(r.id)) {
      const fsVerdict = filesystemVerdict(w, w.content, report.root, r.id, manifest !== null);
      const d = driftById.get(r.id);
      const dFile = d?.files.find((f) => f.path === w.target && f.action === w.action);
      fileRows.push({
        drift: dFile ?? null,
        fs: fsVerdict,
        recipeId: r.id,
        recipeState: d?.state ?? null,
        // The render's hash — the hash of the template the plan just rendered, which the apply
        // records as the file's `renderHash` (a `create` row prints it). The manifest's per-file
        // verdict carries the same value for a recorded file; a first install has no manifest to
        // read it from, so the render is hashed here.
        renderHash: dFile?.renderHash ?? hash(w.content),
        write: w,
      });
    }
  }

  // A verify that greps for a skipped duplicate block's marker would fail even though the block's
  // content is present (#49). The plan has already proven the content is present (the `duplicate`
  // verdict), so it renders that verify with the marker grep replaced by `true` — see
  // `adjustVerifyRun`. Keyed by recipe id, the paths of the recipe's duplicate blocks.
  const duplicatePathsByRecipe = new Map();
  for (const row of fileRows) {
    if (row.fs.verdict !== "duplicate") continue;
    if (!duplicatePathsByRecipe.has(row.recipeId)) duplicatePathsByRecipe.set(row.recipeId, []);
    duplicatePathsByRecipe.get(row.recipeId).push(row.write.target);
  }

  return {
    collisions: collisions.filter((c) => selectedIds.includes(c.recipe)),
    degraded,
    degradedReason: reason,
    drift,
    duplicatePathsByRecipe,
    errored,
    fileRows,
    // A selected recipe whose verify needs a git base, on a repo with no commits: the verify would
    // fail with `could not detect base branch` (#141). The plan surfaces the requirement before the
    // apply, so the consumer commits first (or pins a base) instead of hitting a confusing failure.
    gitWarnings: hasCommits(report.root) ? [] : gitBaseRecipes(selected).map((r) => r.id),
    heldBack,
    manifestPresent: manifest !== null,
    // `--check` prints the drift report, not the plan, so the measurement (which reads the gate
    // artifacts) is skipped: a CI job must not pay for a section it never renders.
    measurement: opts.check ? null : buildMeasurement(report.root, selected),
    narrowNote,
    notSelected: usable
      .filter((r) => !selectedIds.includes(r.id))
      .map((r) => ({
        ...r,
        narrow:
          opts.recipe !== null && r.applicable
            ? "applicable — not selected (narrowed by --recipe)"
            : null,
      })),
    selected,
    selectedIds,
    stack,
    templateErrors,
  };
}

// ---------------------------------------------------------------------------
// Measurement (the adoption flow: measure the current level, install the floor at it)
// ---------------------------------------------------------------------------

// The `floor` value a recipe's gate declares → the artifact that carries its level. The four
// unified-baseline gates plus fallow's two. A gate with no `floor` is a wall at a fixed level and
// is not measured. Coverage has two possible artifacts (bun's lcov, vitest's Istanbul JSON); the
// reader prefers lcov, so the plan reports whichever exists.
const FLOOR_ARTIFACT = {
  coverage: ["lcov", "istanbul"],
  "fallow-dead-code": ["fallowDeadCode"],
  "fallow-health": ["fallowHealth"],
  lint: ["oxlint"],
  mutation: ["mutation"],
  typecheck: ["tsc"],
};

// The greenfield wall: the floor a gate installs when nothing has been measured. 100% on both
// coverage metrics and on mutation, 0 for lint and typecheck, fallow's report-only mode. This is
// the SAME code path as a measured level — the wall is just the level a greenfield repo measures at.
const WALL = {
  coverage: "100% (both metrics)",
  "fallow-dead-code": "report-only",
  "fallow-health": "report-only",
  lint: "0",
  mutation: "100%",
  typecheck: "0",
};

// The newest mtime under `root`, skipping `node_modules`, dot-directories (the installed skill
// lives in one) and the artifact directories themselves — an artifact is not a source file, so
// comparing it against itself would never read stale. Used to tell a fresh artifact from a stale
// one: an artifact older than the newest source file was produced before the last edit, so its
// level is not the current level.
const ARTIFACT_DIRS = new Set(Object.values(ARTIFACTS).map((p) => p.split("/")[0]));

function newestSourceMtime(root) {
  let newest = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".") || ARTIFACT_DIRS.has(e.name))
        continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (e.isFile()) {
        try {
          const m = statSync(p).mtimeMs;
          if (m > newest) newest = m;
        } catch {
          /* unreadable: ignore */
        }
      }
    }
  };
  walk(root);
  return newest;
}

// The artifact's mtime, or null when it is absent. `keys` is the candidate list (coverage has two).
function artifactMtime(root, keys) {
  for (const key of keys) {
    try {
      return statSync(join(root, ARTIFACTS[key])).mtimeMs;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

// The artifact path the plan reports for a gate: the first candidate that exists, else the first.
function artifactPath(root, keys) {
  for (const key of keys) {
    if (existsSync(join(root, ARTIFACTS[key]))) return ARTIFACTS[key];
  }
  return ARTIFACTS[keys[0]];
}

// A coverage/mutation fraction as the text the plan prints: `56.7% (34/60)`. `hit`/`found` for
// coverage, `killed`/`total` for mutation.
function fracText(frac, kind) {
  const num = kind === "mutation" ? frac.killed : frac.hit;
  const den = kind === "mutation" ? frac.total : frac.found;
  return den === 0 ? "100% (0/0)" : `${((num / den) * 100).toFixed(1)}% (${num}/${den})`;
}

// A coverage fraction as the text the plan prints: `lines 56.7% (34/60)  functions 0.0% (0/1)`.
// The metric names come from the source — lcov's `lines`, Istanbul's `statements`.
function coverageText(frac) {
  return Object.entries(frac ?? {})
    .map(([metric, f]) => `${metric} ${fracText(f, "coverage")}`)
    .join("  ");
}

// The measured level of one gate, as the text the plan prints. `null` when the artifact is absent
// (unmeasured) — the caller falls back to the wall.
function levelText(gate, gates) {
  if (gate === "coverage") {
    const g = gates[gate];
    return g ? coverageText(g.global) : null;
  }
  if (gate === "mutation") {
    const g = gates[gate];
    return g ? fracText(g.global, "mutation") : null;
  }
  if (gate === "lint" || gate === "typecheck") {
    const g = gates[gate];
    return g ? String(g.global) : null;
  }
  if (gate === "fallow-health") {
    const g = gates.fallowHealth;
    return g && typeof g.score === "number" ? `${g.score.toFixed(1)} (${g.grade ?? "—"})` : null;
  }
  if (gate === "fallow-dead-code") {
    const g = gates.fallowDeadCode;
    return g && typeof g.global === "number" ? String(g.global) : null;
  }
  return null;
}

// fallow's own floor files, one per fallow gate. Their format is fallow's (a per-file+category
// count map for health, a per-category list for dead code), not a single level, so the plan reports
// the floor as `recorded` when the file exists.
const FALLOW_BASELINE = {
  "fallow-dead-code": ".fallow-dead-code-baseline.json",
  "fallow-health": ".fallow-health-baseline.json",
};

// The floor a gate already has recorded, as the text the plan prints, or `null` when the gate has
// no recorded floor. The unified baseline holds coverage/mutation/lint/typecheck; fallow's floors
// live in fallow's own files.
function recordedFloor(gate, baseline, root) {
  if (gate === "fallow-health" || gate === "fallow-dead-code") {
    return existsSync(join(root, FALLOW_BASELINE[gate])) ? "recorded" : null;
  }
  const g = baseline?.gates?.[gate];
  if (!g) return null;
  if (gate === "coverage") return coverageText(g.global);
  if (gate === "mutation") return fracText(g.global, "mutation");
  return String(g.global);
}

// The adoption flow's measure step. For every gate the selection will install (a selected recipe's
// gate that declares `floor`), read the artifact that carries its level and report the level and
// the floor the apply will install.
//
// The floor is the RECORDED floor when the gate already has one — the apply does not re-raise it,
// so a repo that adopted earlier keeps its floor and a measured level below it is the regression it
// is (the gate that enforces it fails). With no recorded floor the floor is the measured level —
// the SAME code path as greenfield, where the measured level is the wall. An absent artifact is
// `unmeasured`: the floor is the wall, and the apply measures it fresh before writing the baseline.
//
// The plan writes nothing and runs no gate: it reads the artifacts and the baseline that already
// exist. A stale artifact (older than the newest source file) is flagged, not trusted — the apply
// re-runs the gate before `score.mjs --raise`, so the recorded floor is the level of the code as it
// stands.
function buildMeasurement(root, selected) {
  const { gates, errors } = measure(root, [root, safeRealpath(root)]);
  const newest = newestSourceMtime(root);
  const baseline = readBaseline(join(root, ".code-quality-baseline.json"));
  const regressed = new Set((baseline.doc ? compare(gates, baseline.doc) : []).map((r) => r.gate));
  const rows = [];
  const seen = new Set();
  for (const r of selected) {
    for (const g of r.gates ?? []) {
      if (!g.floor) continue;
      const keys = FLOOR_ARTIFACT[g.floor];
      if (!keys || seen.has(g.floor)) continue;
      seen.add(g.floor);
      const level = levelText(g.floor, gates);
      const mtime = artifactMtime(root, keys);
      const stale = mtime !== null && newest > 0 && mtime < newest;
      const recorded = recordedFloor(g.floor, baseline.doc, root);
      rows.push({
        artifact: artifactPath(root, keys),
        floor: recorded ?? level ?? WALL[g.floor],
        gate: g.floor,
        level,
        raise: recorded === null,
        recipe: r.id,
        recorded,
        regression: regressed.has(g.floor),
        source:
          g.floor === "fallow-health" || g.floor === "fallow-dead-code" ? "fallow" : "unified",
        stale,
      });
    }
  }
  return { baselineError: baseline.error, baselinePresent: baseline.doc !== null, errors, rows };
}

function renderMeasurement(measurement) {
  const lines = ["## Measurement (the floor the apply will install)", ""];
  if (measurement.rows.length === 0) {
    lines.push("_No selected gate declares a floor._");
    return lines.join("\n");
  }
  lines.push(
    "_The apply installs each gate with its floor at the measured level, so the gates are green on day one and can only improve. A gate that already has a recorded floor keeps it — the apply does not re-raise it, and a measured level below it is a regression. The floor never rises on its own: only `score.mjs --raise` (or the improvement skill) raises it._",
    "",
  );
  lines.push("| Gate | Measured now | Floor the apply installs | Apply | Source |");
  lines.push("|---|---|---|---|---|");
  for (const row of measurement.rows) {
    const measured =
      row.level === null ? "_unmeasured_" : row.stale ? `${row.level} ⚠ stale` : row.level;
    const floor = row.regression ? `${row.floor} ⚠ regression` : row.floor;
    lines.push(
      `| \`${row.gate}\` | ${measured} | ${floor} | ${row.raise ? "raise" : "keep"} | ${row.source} |`,
    );
  }
  const unmeasured = measurement.rows.filter((r) => r.level === null && r.raise);
  const stale = measurement.rows.filter((r) => r.stale && r.raise);
  const regressions = measurement.rows.filter((r) => r.regression);
  const kept = measurement.rows.filter((r) => !r.raise);
  if (kept.length > 0) {
    lines.push("");
    lines.push(
      `_${kept.length} gate(s) already have a recorded floor — the apply keeps it and does not re-raise it (${kept.map((r) => `\`${r.gate}\``).join(", ")}). A repo that already has a baseline is unchanged._`,
    );
  }
  if (regressions.length > 0) {
    lines.push("");
    lines.push(
      `_${regressions.length} gate(s) measure BELOW their recorded floor — the gate that enforces it fails until the level climbs back (${regressions.map((r) => `\`${r.gate}\``).join(", ")}). The apply does not lower the floor._`,
    );
  }
  if (unmeasured.length > 0) {
    lines.push("");
    lines.push(
      `_${unmeasured.length} gate(s) unmeasured — no artifact yet. The apply runs the gate, then writes the baseline at the level it measures; with no artifact the floor is the greenfield wall (${unmeasured.map((r) => `\`${r.gate}\` ${WALL[r.gate]}`).join(", ")})._`,
    );
  }
  if (stale.length > 0) {
    lines.push("");
    lines.push(
      `_${stale.length} artifact(s) older than the newest source file — the level shown is stale. The apply re-runs the gate before \`score.mjs --raise\`, so the recorded floor is the level of the code as it stands._`,
    );
  }
  if (measurement.baselineError) {
    lines.push("");
    lines.push(
      `_The baseline is unreadable (${measurement.baselineError}) — the plan treats every gate as unrecorded._`,
    );
  }
  if (measurement.errors.length > 0) {
    lines.push("");
    lines.push("_Unreadable artifacts (the gate is unmeasured):_");
    for (const e of measurement.errors) lines.push(`- \`${e.gate}\`: ${e.error}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fmtCost(cost) {
  return cost === "heavy" ? "heavy ⚠ slow verify" : "fast";
}

function renderStack(stack) {
  const { languages, packageManager, workspace } = stack;
  const lines = ["## Stack", ""];
  const langs = [];
  if (languages.typescript) langs.push("typescript");
  if (languages.javascript) langs.push("javascript");
  const strict = languages.typescript
    ? ` (strict: ${languages.typescriptStrict}${languages.typescriptStrictSource ? `, from ${languages.typescriptStrictSource}` : ""})`
    : "";
  lines.push(`- Languages: ${langs.length > 0 ? langs.join(", ") : "none"}${strict}`);
  lines.push(
    `- Package manager: ${packageManager.name ?? "none"}${packageManager.evidence ? ` (${packageManager.source}: ${packageManager.evidence})` : ""}`,
  );
  if (workspace.kind === "workspace") {
    const members = workspace.members.map((m) => m.path).join(", ");
    lines.push(`- Workspace: workspace (${workspace.declaration}) — members: ${members}`);
  } else {
    lines.push(`- Workspace: single`);
  }
  return lines.join("\n");
}

function renderSelection(selected) {
  const lines = [
    `## Selection (${selected.length} recipe${selected.length === 1 ? "" : "s"}, priority order)`,
    "",
  ];
  if (selected.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  selected.forEach((r, i) => {
    lines.push(`${i + 1}. **${r.id}${r.source === "local" ? " (local)" : ""}** — ${r.title}`);
    lines.push(`   ${r.purpose}`);
    lines.push(`   cost: ${fmtCost(r.cost)} · priority: ${r.priority}`);
  });
  return lines.join("\n");
}

function renderNotSelected(notSelected) {
  const lines = ["## Not selected", ""];
  if (notSelected.length === 0) {
    lines.push("_Every recipe applies._");
    return lines.join("\n");
  }
  for (const r of notSelected) {
    const failing = (r.reasons ?? []).filter((x) => !x.pass);
    const detail = r.narrow ?? (failing.length > 0 ? failing[0].detail : "not selected");
    lines.push(`- **${r.id}${r.source === "local" ? " (local)" : ""}** — ${detail}`);
  }
  return lines.join("\n");
}

function renderHeldBack(heldBack) {
  const lines = ["## Held back", ""];
  if (heldBack.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  for (const h of heldBack) lines.push(`- **${h.id}** — ${h.reason}`);
  return lines.join("\n");
}

function renderCollisions(collisions, force) {
  const lines = ["## Collisions", ""];
  if (collisions.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  if (force) lines.push("_Overridden by `--force`._", "");
  else lines.push("_Each needs an explicit override (`--force`)._", "");
  for (const c of collisions) {
    lines.push(`- **${c.recipe}** × \`${c.tool}\``);
    for (const e of c.evidence) lines.push(`  - ${e}`);
  }
  return lines.join("\n");
}

// A `create` row the apply must not overwrite: the filesystem says the repo's file carries content
// the template does not, and the manifest (when present) agrees it is the repo's own content — not
// the skill's own recorded content (`update`) and not a file the apply already merged (`intact`,
// #90). Without a manifest the filesystem verdict is `update`, not `loss`, so this is false.
function isLossRow(row) {
  return row.fs.verdict === "loss" && (row.drift === null || row.drift.verdict === "loss");
}

// A row the Updates section names. Three cases, all "the library's content is written, the repo's
// content kept": a `create` target the repo has extended with no manifest (fs.verdict `update`,
// #90), a `create` target whose file is the library's own earlier render (fs.verdict `update` with
// `olderRender`, #167), and a file the manifest records as the skill's own content while the
// library's render moved (drift.verdict `update`). The Files label comes from the drift verdict when
// a manifest is present and from the filesystem verdict otherwise, so the section must name all of
// them — otherwise a row reads `update` while no section names it (#155).
function isUpdateRow(row) {
  return row.fs.verdict === "update" || (row.drift !== null && row.drift.verdict === "update");
}

function verdictLabel(row) {
  if (row.fs.verdict === "duplicate") return "duplicate";
  if (isLossRow(row)) return "loss";
  if (row.drift) {
    const extra = row.drift.updateAvailable && row.drift.verdict !== "update" ? "+update" : "";
    return `${row.drift.verdict}${extra}`;
  }
  return row.fs.verdict;
}

function renderFiles(plan, opts) {
  const lines = ["## Files (phase 1 — writes, priority order)", ""];
  let rows = plan.fileRows;
  if (opts.diffPath) {
    rows = rows.filter((r) => r.write.target === opts.diffPath);
    if (rows.length === 0) {
      lines.push(`_No file to write at \`${opts.diffPath}\`._`);
      return lines.join("\n");
    }
  }
  if (rows.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  for (const row of rows) {
    const w = row.write;
    const scope = w.member ? `${w.scope} (${w.member})` : w.scope;
    const label = verdictLabel(row);
    // A `create` the apply already merged reads `intact` (#90), or a file the manifest records as
    // the skill's own content while the library moved reads `update` (drift), while the filesystem
    // verdict is `loss`; the note ("overwriting drops them") describes the overwrite the apply must
    // not do, not the state, so it is suppressed. A `patch`/`merge` `intact` keeps its note.
    const note =
      row.fs.note &&
      !(row.fs.verdict === "loss" && (label === "intact" || row.drift?.verdict === "update"))
        ? ` — ${row.fs.note}`
        : "";
    // A `create` row carries the render hash the apply records (` · render <hash>`), so a later
    // library move that only removes content reads `update` instead of being silently dropped
    // (#166). A `merge`/`patch` row's `hash` is already the render's, so it carries none.
    const render =
      w.action === "create" && row.renderHash != null ? ` · render ${row.renderHash}` : "";
    lines.push(`- \`${w.target}\` (${w.action}, ${scope}) — **${label}**${note}${render}`);
    const showDiff =
      opts.diffPath !== null ||
      opts.diff ||
      (row.fs.diff &&
        (w.action === "merge" ||
          w.action === "patch" ||
          row.fs.verdict === "collision" ||
          row.fs.verdict === "loss" ||
          row.fs.verdict === "update"));
    if (showDiff && row.fs.diff) {
      lines.push("");
      for (const dl of row.fs.diff.split("\n")) lines.push(`    ${dl}`);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd();
}

// The hand-set-up repo (#35): a marker merge block whose marker is absent but whose content the
// file already carries. The Files section shows the `duplicate` verdict; this section names the
// evidence and the decision, so the agent skips the block instead of appending a second one.
function renderPreExisting(plan) {
  const rows = plan.fileRows.filter((r) => r.fs.verdict === "duplicate");
  const lines = ["## Pre-existing content (duplicate blocks)", ""];
  if (rows.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  lines.push(
    "_The file already carries these blocks' content (no marker). Do not append them: the gate is already wired. A recipe whose verify greps for a skipped block's marker fails as-is and stays unrecorded._",
    "",
  );
  for (const row of rows) {
    lines.push(`- \`${row.write.target}\` (${row.recipeId}) — ${row.fs.note}`);
  }
  return lines.join("\n");
}

// A `create` target the repo has customized (#36): the repo's file carries content the template
// does not, so overwriting it drops that content. The Files section shows the `loss` verdict; this
// section names the lost lines and the decision, so the agent leaves the file alone unless the
// human explicitly overrides. A `create` file the manifest records as `update` is the skill's own
// recorded content — the difference is the library's, not the repo's — so it is not a loss.
function renderLosses(plan, force) {
  const rows = plan.fileRows.filter((r) => isLossRow(r));
  const lines = ["## Losses (create drift — the repo's extra content would be dropped)", ""];
  if (rows.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  if (force) {
    lines.push(
      "_Overridden by `--force` — the files below are overwritten and their extra content dropped._",
      "",
    );
  } else {
    lines.push(
      "_Do not overwrite these files: the repo's file carries content the template does not. Overwrite only on an explicit override (`--force`)._",
      "",
    );
  }
  for (const row of rows) {
    lines.push(
      `- \`${row.write.target}\` (${row.recipeId}) — ${row.fs.lost.length} ${row.fs.unit}(s) the template lacks:`,
    );
    for (const l of row.fs.lost) lines.push(`  - \`${l}\``);
  }
  return lines.join("\n");
}

// The rows the Updates section names (`isUpdateRow`): a `create` target the repo has extended with
// no manifest (#90), a `create` target whose file is the library's own earlier render (#167), and a
// file the manifest records as the skill's own content while the library's render moved (the drift
// `update` state). All three mean the library's content is written and the repo's content is kept —
// the #90 case merges the repo's additions into the library's content, the other two re-render the
// file (the earlier render's lines are the library's, not the repo's). This section names the
// additions and the decision, so the agent merges instead of overwriting (which would drop them) or
// skipping (which would leave the gate uninstalled). A `create` row carries the lost items
// (`fs.lost`); a `merge`/`patch` row has none, so it names the library move instead.
function renderUpdates(plan) {
  const rows = plan.fileRows.filter((r) => isUpdateRow(r));
  if (rows.length === 0) return null;
  const lines = ["## Updates (the library's content is written, the repo's content kept)", ""];
  lines.push(
    "_The library's content is written and the repo's content is kept. A `create` target the repo has extended with no manifest is merged — write the library's content and re-apply the repo's additions below; do not overwrite it verbatim (that drops them). A `create` target whose file is an earlier render of the template is re-rendered from the current library — the items below are the previous render's lines, not the repo's additions, so re-applying them would duplicate keys and break the config. A file the manifest records as the skill's own content is re-rendered because the library's render moved. Do not skip any of them — that leaves the gate uninstalled. The diff shows the library's content against the repo's file._",
    "",
  );
  for (const row of rows) {
    // The lost items are the repo's additions only in the #90 case (fs.verdict `update` without
    // `olderRender`): there the file carries the template's content plus the repo's own lines. An
    // earlier render (`olderRender`) and a manifest-present `update` (drift.verdict `update`) are
    // the library's own content, so their "lost" items are the previous render's lines, not the
    // repo's — the apply re-renders, it does not re-apply them.
    if (row.fs.verdict === "update" && row.fs.olderRender) {
      lines.push(
        `- \`${row.write.target}\` (${row.recipeId}) — the repo's file is an earlier render of the template; re-render it from the current library and do NOT re-apply the ${row.fs.lost.length} ${row.fs.unit}(s) below (they are the previous render's lines — re-applying them duplicates keys):`,
      );
      for (const l of row.fs.lost) lines.push(`  - \`${l}\``);
    } else if (row.fs.verdict === "update" && row.fs.lost) {
      lines.push(
        `- \`${row.write.target}\` (${row.recipeId}) — ${row.fs.lost.length} ${row.fs.unit}(s) the template lacks:`,
      );
      for (const l of row.fs.lost) lines.push(`  - \`${l}\``);
    } else {
      lines.push(
        `- \`${row.write.target}\` (${row.recipeId}) — the library's render moved; re-render it from the current library`,
      );
    }
  }
  return lines.join("\n");
}

function renderCommands(selected, workspace) {
  const lines = ["## Commands (phase 2 — commands, priority order)", ""];
  const rows = [];
  for (const r of selected) {
    for (const c of r.commands ?? []) {
      if (c.showInPlan === false) continue;
      rows.push({ recipe: r.id, ...c });
    }
  }
  if (rows.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  rows.forEach((c, i) => {
    const scope = c.scope ?? "root";
    lines.push(
      `${i + 1}. [${c.recipe}] \`${c.run}\` (${scope} → ${resolveScopes(scope, workspace).join(", ")})`,
    );
    // A formatter sweep rewrites files the recipe does not own — the repo's own source included
    // (biome-assist.md: "The plan must show this step as *reformats existing files*"). The plan
    // cannot know which files until the sweep runs, so it says so instead of staying silent.
    if (/\bcheck --write\b/.test(c.run)) {
      lines.push(
        `   *reformats existing files* — the sweep rewrites every file it can format, including files this recipe does not own; the plan cannot name them before it runs.`,
      );
    }
  });
  return lines.join("\n");
}

// A verify that greps for a skipped duplicate block's marker would fail even though the block's
// content is present (#49). The plan has already proven the content is present (the `duplicate`
// verdict), so it renders that verify with the marker grep replaced by `true`. The clause is the
// recipe's own marker grep — `grep -q "code-quality:<id>:start" <path>` — and `<path>` is the
// duplicate block's file, so the replacement is exact (an optional `./` prefix is tolerated).
function adjustVerifyRun(run, recipeId, duplicatePaths) {
  let out = run;
  for (const path of duplicatePaths) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`grep -q "code-quality:${recipeId}:start" \\.?/?${escaped}(?=\\s|$)`);
    out = out.replace(re, "true");
  }
  return out;
}

function renderGatesAndVerify(selected, workspace, duplicatePathsByRecipe) {
  const lines = ["## Gates and verify (phase 3 — verify, priority order)", ""];
  if (selected.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  for (const r of selected) {
    lines.push(`### ${r.id}`);
    if ((r.gates ?? []).length > 0) {
      lines.push("Gates:");
      for (const g of r.gates)
        lines.push(`- \`${g.id}\` — \`${g.run}\`${g.description ? `: ${g.description}` : ""}`);
    } else {
      lines.push("Gates: _none_");
    }
    if ((r.verify ?? []).length > 0) {
      lines.push("Verify:");
      for (const v of r.verify) {
        const scope = v.scope ?? "root";
        const dirs = resolveScopes(scope, workspace).join(", ");
        const run = v.gate
          ? null
          : adjustVerifyRun(v.run, r.id, duplicatePathsByRecipe.get(r.id) ?? []);
        lines.push(`- ${v.gate ? `gate \`${v.gate}\`` : `\`${run}\``} (${scope} → ${dirs})`);
      }
    } else {
      lines.push("Verify: _none_");
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function renderWarnings(errored, templateErrors, gitWarnings) {
  const lines = ["## Warnings", ""];
  if (errored.length === 0 && templateErrors.length === 0 && gitWarnings.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  for (const r of errored) lines.push(`- \`{ id: "${r.id}", error: ${JSON.stringify(r.error)} }\``);
  for (const t of templateErrors)
    lines.push(`- \`{ id: "${t.id}", error: ${JSON.stringify(t.error)} }\``);
  for (const id of gitWarnings) {
    lines.push(
      [
        `- \`${id}\`: the project has no commits, so the audit's base cannot be detected —`,
        "`fallow audit` exits 2 with `could not detect base branch`. Commit before the verify,",
        "or pin the base with `FALLOW_AUDIT_BASE=<ref>` (or `fallow audit --base <ref>`).",
      ].join(" "),
    );
  }
  return lines.join("\n");
}

// The "nothing applies" fix hint (#17): when the blocking reason is the package-manager allowlist,
// name the fix. The message must stay true: "no package manager detected" only when there is none.
function nothingAppliesHint(notSelected, packageManager) {
  const pmBlocked = notSelected.filter((r) =>
    (r.reasons ?? []).some((x) => !x.pass && x.predicate === "packageManager"),
  );
  if (pmBlocked.length === 0) return null;
  if (packageManager.name === null) {
    return [
      "No recipes apply: no package manager detected.",
      "Run `bun install` (or add a `packageManager` field to package.json), then re-run.",
    ].join("\n");
  }
  return [
    `No recipes apply: package manager \`${packageManager.name}\` is not covered by any recipe.`,
    "Use bun, npm, or pnpm, then re-run.",
  ].join("\n");
}

// The `## Drift (manifest)` section text, or null when the plan has no drift information to
// report. `renderPlan` prints it verbatim; `--check` carries it in the JSON's `markdown` field, so
// the consumer posts the section byte-for-byte. The plan suppresses the section when nothing is
// selected and there is no manifest — it already says "Nothing applies" and there is no library to
// compare against — but `--check` reports the degraded note in that case anyway, because a CI job
// must be able to say why it has no verdicts.
function renderDriftSection(plan) {
  if (plan.manifestPresent && plan.drift) {
    const states = plan.drift.recipes.map((r) => `${r.id}: ${r.state}`).join(", ");
    return ["## Drift (manifest)", "", states].join("\n");
  }
  if (plan.degraded) {
    return [
      "## Drift (manifest)",
      "",
      `_Degraded — ${plan.degradedReason}; comparing against the current library only._`,
    ].join("\n");
  }
  return null;
}

function renderPlan(plan, opts) {
  const out = [];
  out.push("# code-quality-setup plan", "");

  // Entry state.
  if (plan.narrowNote) {
    out.push(`**Nothing applies.** ${plan.narrowNote}`, "");
  } else if (plan.selected.length === 0) {
    out.push("**Nothing applies.**", "");
    const hint = nothingAppliesHint(plan.notSelected, plan.stack.packageManager);
    if (hint) out.push(hint, "");
  } else if (
    plan.manifestPresent &&
    plan.drift &&
    plan.drift.recipes.every((r) => r.state === "intact")
  ) {
    out.push(
      `**Already set up** — ${plan.selected.length} recipe(s) applied, every file intact.`,
      "",
    );
  } else {
    const dupes = plan.fileRows.filter((r) => r.fs.verdict === "duplicate").length;
    const losses = plan.fileRows.filter((r) => isLossRow(r)).length;
    const updates = plan.fileRows.filter((r) => isUpdateRow(r)).length;
    const dupNote =
      dupes > 0 ? ` ${dupes} block(s) already present — see Pre-existing content.` : "";
    const lossNote = losses > 0 ? ` ${losses} file(s) would lose repo content — see Losses.` : "";
    const updateNote =
      updates > 0 ? ` ${updates} file(s) need the new library render — see Updates.` : "";
    out.push(
      `**Plan ready** — ${plan.selected.length} recipe(s) selected.${dupNote}${lossNote}${updateNote}`,
      "",
    );
  }

  out.push(renderStack(plan.stack), "");
  out.push(renderSelection(plan.selected), "");
  out.push(renderMeasurement(plan.measurement), "");
  out.push(renderNotSelected(plan.notSelected), "");
  out.push(renderHeldBack(plan.heldBack), "");
  out.push(renderCollisions(plan.collisions, opts.force), "");
  out.push(renderFiles(plan, opts), "");
  out.push(renderLosses(plan, opts.force), "");
  const updatesSection = renderUpdates(plan);
  if (updatesSection !== null) out.push(updatesSection, "");
  out.push(renderPreExisting(plan), "");
  out.push(renderCommands(plan.selected, plan.stack.workspace), "");
  out.push(
    renderGatesAndVerify(plan.selected, plan.stack.workspace, plan.duplicatePathsByRecipe),
    "",
  );
  out.push(renderWarnings(plan.errored, plan.templateErrors, plan.gitWarnings), "");

  // The drift section is suppressed when nothing is selected and there is no manifest: the plan
  // already says "Nothing applies" and there is no library to compare against.
  const driftSection = renderDriftSection(plan);
  if (driftSection !== null && (plan.manifestPresent || plan.selected.length > 0))
    out.push(driftSection, "");

  if (plan.selected.length > 0) {
    const losses = plan.fileRows.filter((r) => isLossRow(r)).length;
    const lossNote =
      losses > 0 && !opts.force
        ? ` ${losses} file(s) would lose repo content and are NOT overwritten without \`--force\` (see Losses).`
        : "";
    const updates = plan.fileRows.filter((r) => isUpdateRow(r)).length;
    const updateNote =
      updates > 0
        ? ` ${updates} file(s) need the new library render and are merged, not overwritten (see Updates).`
        : "";
    out.push(
      `Approve? Apply the ${plan.selected.length} recipe(s) above: phase 1 writes every file, phase 2 runs every command, phase 3 runs every verify.${lossNote}${updateNote}`,
    );
  }
  return out.join("\n").trimEnd() + "\n";
}

// `--check` (#52): the machine-readable drift report the ci-drift workflow (#54) consumes. One JSON
// document on stdout — the same per-recipe verdicts the `## Drift (manifest)` section prints, plus
// the section text itself so the consumer posts it verbatim.
//
// `clean` is "the report is clean": a manifest is present and no recipe has drifted. Drift is the
// repo's own content diverging from what the skill recorded — `drifted` (hand-edited), `missing`
// (deleted), `loss` (a `create` target the repo customized). The other states are not drift:
// `new` (a selected recipe never applied — the repo may be mid-setup, or the library grew a
// recipe), `declined` (the user declined it), `update` (the library's render moved; the repo's file
// is untouched — SKILL.md → Re-run), `stale` (the library dropped a recorded recipe). A degraded
// report (no manifest, or one that is corrupt or from another schemaVersion) is not clean either:
// the check cannot establish that the repo is as the skill left it, and a false "clean" is worse
// than a false "dirty". See PLAN-SCHEMA.md → `--check`.
const DRIFT_STATES = new Set(["drifted", "missing", "loss"]);

function checkReport(plan) {
  const recipes = (plan.drift?.recipes ?? []).map((r) => ({ id: r.id, state: r.state }));
  const clean = plan.manifestPresent && !recipes.some((r) => DRIFT_STATES.has(r.state));
  return {
    clean,
    degraded: plan.degraded,
    degradedReason: plan.degradedReason,
    manifestPresent: plan.manifestPresent,
    markdown: renderDriftSection(plan),
    recipes,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  let report;
  try {
    report = runDetector(opts.projectDir, resolveLibraryDir(opts.library));
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).trim() : err.message;
    process.stderr.write(`plan.mjs: detector failed\n${stderr}\n`);
    process.exit(1);
  }

  // Unsupported: no TypeScript.
  if (!report.stack.languages.typescript) {
    process.stdout.write("Unsupported: no TypeScript detected. Nothing to plan.\n");
    return;
  }

  // A malformed recipe is a warning; fail only when no usable recipe remains.
  const usable = report.recipes.filter((r) => r.error === null);
  if (usable.length === 0) {
    process.stderr.write("plan.mjs: no usable recipe remains — every recipe file is malformed\n");
    for (const r of report.recipes)
      process.stderr.write(`  { id: "${r.id}", error: ${JSON.stringify(r.error)} }\n`);
    process.exit(1);
  }

  const plan = buildPlan(report, opts);
  if (opts.check) {
    const check = checkReport(plan);
    process.stdout.write(`${JSON.stringify(check, null, 2)}\n`);
    process.exitCode = check.clean ? 0 : 1;
    return;
  }
  process.stdout.write(renderPlan(plan, opts));
}

try {
  main();
} catch (err) {
  process.stderr.write(`plan.mjs: ${err.message}\n`);
  process.exit(1);
}
