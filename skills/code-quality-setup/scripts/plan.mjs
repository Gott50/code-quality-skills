#!/usr/bin/env node
// plan.mjs — the code-quality-setup plan renderer.
//
// Zero dependencies, node builtins only. Runs the detector (detect.mjs) and prints the plan the
// agent shows for approval: the stack, the selection, the applicability matrix, held-back recipes,
// collisions, every file to be written (with inline diffs for merge/patch/collision), the commands
// in order, the gates and verify left behind, and a warning per unreadable recipe. It never writes
// anything and never invokes a package manager.
//
// Usage: node scripts/plan.mjs [projectDir] [--recipe <id>] [--force] [--diff [path]]
//
// The output shape is specified in PLAN-SCHEMA.md next to this file; the recipe frontmatter and the
// substitution keys it renders are specified in ../RECIPE-CONTRACT.md; the JSON it consumes is
// specified in DETECT-SCHEMA.md.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DETECT = join(SKILL_DIR, "scripts", "detect.mjs");
const MANIFEST_NAME = ".code-quality.json";
const MANIFEST_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { projectDir: ".", recipe: null, force: false, diff: false, diffPath: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--recipe") {
      opts.recipe = argv[++i];
      if (opts.recipe === undefined) throw new Error("--recipe needs an id");
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

function runDetector(projectDir) {
  const out = execFileSync(process.execPath, [DETECT, projectDir], {
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
      path: f.path,
      action: f.action,
      scope: f.scope ?? "root",
      memberMode: f.memberMode ?? "standalone",
      template: f.template,
      target,
      member,
      rootPrefix,
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

function readTemplate(skillRelPath) {
  return readFileSync(join(SKILL_DIR, skillRelPath), "utf8");
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
// a duplicate: biome-assist's `.gitignore` block adds `node_modules/` (present) and
// `.code-quality.json` (absent), and must still apply):
//   - line presence: every non-blank payload line already appears in the file, compared after
//     normalizing whitespace (a hand-written hook aligns its `||` with spaces);
//   - command presence: the payload is a documentation section (it carries a heading) and every
//     gate command it names already appears in the file (a hand-written AGENTS.md documents the
//     same gates in a different shape — bullets and arrows, not the rendered table).
// Returns a human-readable evidence string, or null when the block contributes something new.
function blockAlreadyPresent(existing, content, recipeId) {
  const norm = (s) => s.trim().replace(/\s+/g, " ");
  const payload = content
    .split("\n")
    .filter((line) => !line.includes(`code-quality:${recipeId}:start`) && !line.includes(`code-quality:${recipeId}:end`));
  const fileLines = new Set(existing.split("\n").map(norm));
  const significant = payload.map(norm).filter((l) => l !== "");
  if (significant.length > 0 && significant.every((l) => fileLines.has(l))) {
    return "every line already present";
  }
  if (payload.some((l) => /^#{1,6}\s/.test(l.trim()))) {
    const commands = [
      ...new Set([...content.matchAll(/\b(?:bunx?|npm|pnpm|npx)\s+(?:run\s+)?([A-Za-z0-9:_@./-]+)/g)].map((m) => m[1])),
    ];
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (commands.length > 0 && commands.every((c) => new RegExp(`\\b${escape(c)}\\b`).test(existing))) {
      return `already documents: ${commands.join(", ")}`;
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
      value: value.replace(/\s+/g, " ").trim(),
      collection: value.startsWith("[") || value.startsWith("{"),
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
    return doc === undefined ? MISSING : doc;
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
      } else if (JSON.stringify(d[key]) !== JSON.stringify(value)) {
        changed.push(path);
      }
    }
  };
  walk(frag, doc, "");
  return { changed, added };
}

// The subset of `frag` whose leaves already exist in `doc` — the recipe's owned content as it
// stands, for the inline diff. `undefined` when none of it is present.
function presentFragment(doc, frag) {
  if (frag === null || typeof frag !== "object" || Array.isArray(frag)) return doc === undefined ? undefined : doc;
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
      ...aLines.map((line) => ({ type: "-", line })),
      ...bLines.map((line) => ({ type: "+", line })),
    ];
  }
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ type: " ", line: aLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "-", line: aLines[i] });
      i++;
    } else {
      out.push({ type: "+", line: bLines[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "-", line: aLines[i++] });
  while (j < m) out.push({ type: "+", line: bLines[j++] });
  return out;
}

function unifiedDiff(aText, bText, path) {
  const ops = diffLines(aText, bText);
  if (!ops.some((o) => o.type !== " ")) return "";
  let oldNo = 1;
  let newNo = 1;
  const annotated = ops.map((o) => {
    const rec = { ...o, oldNo, newNo };
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
    return Object.entries(repo).every(([key, value]) => Object.hasOwn(template, key) && covers(template[key], value));
  }
  if (Array.isArray(template) && Array.isArray(repo)) {
    return repo.every((element) => template.some((candidate) => covers(candidate, element)));
  }
  return template === repo;
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
      return { unit: "key", items: lostPaths(repo, template, "") };
    }
  }
  const norm = (s) => s.trim().replace(/\s+/g, " ");
  const templateLines = new Set(content.split("\n").map(norm));
  return {
    unit: "line",
    items: existing
      .split("\n")
      .map(norm)
      .filter((line) => line !== "" && !templateLines.has(line)),
  };
}

// Whether a `create` file's on-disk content is a loss (#36, #46): the repo's file carries content
// the template does not, so the apply skipped it. The manifest recorded the rendered template's
// hash — the apply records what it would have written, even for a skipped file — so the hash
// comparison alone reads `drifted`, as if the repo had hand-edited the skill's own bytes. It did
// not: the file is the repo's, the library has not moved, and the Files section already shows
// `loss`. The content comparison is what tells the two apart, so the drift report uses it too.
function isCreateLoss(f, files) {
  return f.action === "create" && files[f.path] != null && lostContent(files[f.path], f.content, f.path).items.length > 0;
}

// The verdict for one write, from the filesystem alone (no manifest): create → new/no-op/drift/loss,
// merge → new/no-op/add/replace/collision, patch → new/patch. `diff` is the inline unified diff.
function filesystemVerdict(write, content, projectRoot, recipeId) {
  const abs = join(projectRoot, write.target);
  const existing = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  const entry = { path: write.target, action: write.action, content };

  if (write.action === "create") {
    if (existing === null) return { verdict: "new", diff: unifiedDiff("", content, write.target) };
    if (existing === content) return { verdict: "no-op" };
    const { unit, items: lost } = lostContent(existing, content, write.target);
    if (lost.length > 0) {
      return {
        verdict: "loss",
        note: `the repo's file carries ${lost.length} ${unit}(s) the template does not — overwriting drops them`,
        lost,
        unit,
        diff: unifiedDiff(existing, content, write.target),
      };
    }
    return { verdict: "drift", diff: unifiedDiff(existing, content, write.target) };
  }

  if (write.action === "merge") {
    if (mergeKind(entry, recipeId) === "json") {
      const frag = JSON.parse(content);
      if (existing === null) return { verdict: "new", diff: unifiedDiff("", JSON.stringify(frag, null, 2), write.target) };
      const doc = tryParseJson(existing);
      if (doc === null) return { verdict: "collision", note: "target is not valid JSON", diff: unifiedDiff(existing, content, write.target) };
      const { changed, added } = jsonMergeDelta(doc, frag);
      const present = presentFragment(doc, frag);
      const diff = unifiedDiff(present ? JSON.stringify(present, null, 2) : "", JSON.stringify(frag, null, 2), write.target);
      if (changed.length > 0) {
        return { verdict: "collision", note: `would change: ${changed.join(", ")}`, diff };
      }
      if (added.length > 0) {
        return { verdict: "add", note: `adds: ${added.join(", ")}`, diff };
      }
      return { verdict: "no-op" };
    }
    const block = existing === null ? null : extractBlock(existing, recipeId);
    const target = content.replace(/\n+$/, "");
    if (block === null) {
      const evidence = existing === null ? null : blockAlreadyPresent(existing, content, recipeId);
      if (evidence !== null) {
        return { verdict: "duplicate", note: `already present — ${evidence}; skip this block`, diff: unifiedDiff("", target, write.target) };
      }
      return { verdict: "new", diff: unifiedDiff("", target, write.target) };
    }
    if (block === target) return { verdict: "no-op" };
    return { verdict: "replace", diff: unifiedDiff(block, target, write.target) };
  }

  if (write.action === "patch") {
    if (existing === null) return { verdict: "new", note: "created from the template" };
    // The after-state the recipe body states already holds (#37): the target declares every key the
    // template declares, with the template's scalar values. The patch is a no-op, so the plan says
    // so instead of showing the template as the target.
    if (patchOwned(content, existing) === patchOwned(content, content)) {
      return { verdict: "no-op", note: "the after-state already holds" };
    }
    return {
      verdict: "patch",
      note: "unverifiable — the recipe body states the before/after",
      diff: unifiedDiff(existing, content, write.target),
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
  if (!existsSync(abs)) return { manifest: null, degraded: true, reason: "no manifest" };
  const parsed = tryParseJson(readFileSync(abs, "utf8"));
  if (parsed === null) return { manifest: null, degraded: true, reason: "manifest is not valid JSON" };
  if (parsed.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    return { manifest: null, degraded: true, reason: `manifest schemaVersion ${parsed.schemaVersion} ≠ ${MANIFEST_SCHEMA_VERSION}` };
  }
  return { manifest: parsed, degraded: false, reason: null };
}

const RANK = { missing: 5, loss: 4, drifted: 3, update: 2, intact: 1 };

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
      recipes.push({ id: lib.id, state: declined.has(lib.id) ? "declined" : "new", files: [] });
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
      let verdict;
      if (duplicate) verdict = "intact";
      else if (presentHash === null) verdict = "missing";
      else if (presentHash === currentHash) verdict = "intact";
      else if (recordedHash !== null && presentHash === recordedHash) verdict = "update";
      else if (isCreateLoss(f, files)) verdict = "loss";
      else verdict = "drifted";
      return {
        path: f.path,
        action: f.action,
        kind: f.action === "merge" ? mergeKind(f, lib.id) : null,
        verdict,
        updateAvailable: recordedHash !== null && recordedHash !== currentHash,
        recordedHash,
        currentHash,
        presentHash,
      };
    });
    recipes.push({
      id: lib.id,
      state: rollUp(fileVerdicts),
      recipeChanged: rec.recipeHash !== lib.hash,
      files: fileVerdicts,
    });
  }

  for (const rec of manifest?.recipes ?? []) {
    if (!known.has(rec.id)) recipes.push({ id: rec.id, state: "stale", files: [] });
  }
  return { recipes };
}

// ---------------------------------------------------------------------------
// Plan assembly
// ---------------------------------------------------------------------------

function buildPlan(report, opts) {
  const { stack, recipes, selection, heldBack, collisions } = report;
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
    gates: renderGatesTable(selected),
    details: renderDetails(selected),
    areas: renderAreas(stack.workspace),
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
        content = substitute(readTemplate(w.template), { ...subst, root: w.rootPrefix });
      } catch (err) {
        templateErrors.push({ id: r.id, error: `${w.template}: ${err.message}` });
        continue;
      }
      writes.push({ ...w, recipeId: r.id, content });
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
    id: r.id,
    hash: hash(
      readFileSync(join(SKILL_DIR, "references", "recipes", `${r.id}.md`), "utf8") +
        writesByRecipe.get(r.id).map((w) => w.content).join("\n"),
    ),
    files: writesByRecipe.get(r.id).map((w) => ({ path: w.target, action: w.action, content: w.content })),
  }));
  const drift = manifest ? classify(manifest, { library, files }) : null;
  const driftById = new Map((drift?.recipes ?? []).map((r) => [r.id, r]));

  // Per-write verdicts: manifest-aware when a manifest is present, filesystem-only otherwise.
  const fileRows = [];
  for (const r of selected) {
    for (const w of writesByRecipe.get(r.id)) {
      const fsVerdict = filesystemVerdict(w, w.content, report.root, r.id);
      const d = driftById.get(r.id);
      const dFile = d?.files.find((f) => f.path === w.target && f.action === w.action);
      fileRows.push({
        recipeId: r.id,
        write: w,
        fs: fsVerdict,
        drift: dFile ?? null,
        recipeState: d?.state ?? null,
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
    stack,
    selected,
    selectedIds,
    narrowNote,
    duplicatePathsByRecipe,
    notSelected: usable
      .filter((r) => !selectedIds.includes(r.id))
      .map((r) => ({
        ...r,
        narrow: opts.recipe !== null && r.applicable ? "applicable — not selected (narrowed by --recipe)" : null,
      })),
    heldBack,
    collisions: collisions.filter((c) => selectedIds.includes(c.recipe)),
    errored,
    templateErrors,
    fileRows,
    drift,
    degraded,
    degradedReason: reason,
    manifestPresent: manifest !== null,
  };
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
  const lines = [`## Selection (${selected.length} recipe${selected.length === 1 ? "" : "s"}, priority order)`, ""];
  if (selected.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  selected.forEach((r, i) => {
    lines.push(`${i + 1}. **${r.id}** — ${r.title}`);
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
    lines.push(`- **${r.id}** — ${detail}`);
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

function verdictLabel(row) {
  if (row.fs.verdict === "duplicate") return "duplicate";
  // A `create` file the manifest records as `update` is the skill's own recorded content: the
  // difference is the library's, not the repo's, so it is not a loss (#36).
  if (row.fs.verdict === "loss" && row.drift?.verdict !== "update") return "loss";
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
    const note = row.fs.note ? ` — ${row.fs.note}` : "";
    lines.push(`- \`${w.target}\` (${w.action}, ${scope}) — **${label}**${note}`);
    const showDiff =
      opts.diffPath !== null ||
      opts.diff ||
      (row.fs.diff && (w.action === "merge" || w.action === "patch" || row.fs.verdict === "collision" || row.fs.verdict === "loss"));
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
  lines.push("_The file already carries these blocks' content (no marker). Do not append them: the gate is already wired. A recipe whose verify greps for a skipped block's marker fails as-is and stays unrecorded._", "");
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
  const rows = plan.fileRows.filter((r) => r.fs.verdict === "loss" && r.drift?.verdict !== "update");
  const lines = ["## Losses (create drift — the repo's extra content would be dropped)", ""];
  if (rows.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  if (force) {
    lines.push("_Overridden by `--force` — the files below are overwritten and their extra content dropped._", "");
  } else {
    lines.push("_Do not overwrite these files: the repo's file carries content the template does not. Overwrite only on an explicit override (`--force`)._", "");
  }
  for (const row of rows) {
    lines.push(`- \`${row.write.target}\` (${row.recipeId}) — ${row.fs.lost.length} ${row.fs.unit}(s) the template lacks:`);
    for (const l of row.fs.lost) lines.push(`  - \`${l}\``);
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
    lines.push(`${i + 1}. [${c.recipe}] \`${c.run}\` (${scope} → ${resolveScopes(scope, workspace).join(", ")})`);
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
      for (const g of r.gates) lines.push(`- \`${g.id}\` — \`${g.run}\`${g.description ? `: ${g.description}` : ""}`);
    } else {
      lines.push("Gates: _none_");
    }
    if ((r.verify ?? []).length > 0) {
      lines.push("Verify:");
      for (const v of r.verify) {
        const scope = v.scope ?? "root";
        const dirs = resolveScopes(scope, workspace).join(", ");
        const run = v.gate ? null : adjustVerifyRun(v.run, r.id, duplicatePathsByRecipe.get(r.id) ?? []);
        lines.push(`- ${v.gate ? `gate \`${v.gate}\`` : `\`${run}\``} (${scope} → ${dirs})`);
      }
    } else {
      lines.push("Verify: _none_");
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function renderWarnings(errored, templateErrors) {
  const lines = ["## Warnings", ""];
  if (errored.length === 0 && templateErrors.length === 0) {
    lines.push("_None._");
    return lines.join("\n");
  }
  for (const r of errored) lines.push(`- \`{ id: "${r.id}", error: ${JSON.stringify(r.error)} }\``);
  for (const t of templateErrors) lines.push(`- \`{ id: "${t.id}", error: ${JSON.stringify(t.error)} }\``);
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
  } else if (plan.manifestPresent && plan.drift && plan.drift.recipes.every((r) => r.state === "intact")) {
    out.push(`**Already set up** — ${plan.selected.length} recipe(s) applied, every file intact.`, "");
  } else {
    const dupes = plan.fileRows.filter((r) => r.fs.verdict === "duplicate").length;
    const losses = plan.fileRows.filter((r) => r.fs.verdict === "loss" && r.drift?.verdict !== "update").length;
    const dupNote = dupes > 0 ? ` ${dupes} block(s) already present — see Pre-existing content.` : "";
    const lossNote = losses > 0 ? ` ${losses} file(s) would lose repo content — see Losses.` : "";
    out.push(`**Plan ready** — ${plan.selected.length} recipe(s) selected.${dupNote}${lossNote}`, "");
  }

  out.push(renderStack(plan.stack), "");
  out.push(renderSelection(plan.selected), "");
  out.push(renderNotSelected(plan.notSelected), "");
  out.push(renderHeldBack(plan.heldBack), "");
  out.push(renderCollisions(plan.collisions, opts.force), "");
  out.push(renderFiles(plan, opts), "");
  out.push(renderLosses(plan, opts.force), "");
  out.push(renderPreExisting(plan), "");
  out.push(renderCommands(plan.selected, plan.stack.workspace), "");
  out.push(renderGatesAndVerify(plan.selected, plan.stack.workspace, plan.duplicatePathsByRecipe), "");
  out.push(renderWarnings(plan.errored, plan.templateErrors), "");

  if (plan.manifestPresent && plan.drift) {
    const states = plan.drift.recipes.map((r) => `${r.id}: ${r.state}`).join(", ");
    out.push(`## Drift (manifest)`, "", states, "");
  } else if (plan.degraded && plan.selected.length > 0) {
    out.push(`## Drift (manifest)`, "", `_Degraded — ${plan.degradedReason}; comparing against the current library only._`, "");
  }

  if (plan.selected.length > 0) {
    const losses = plan.fileRows.filter((r) => r.fs.verdict === "loss" && r.drift?.verdict !== "update").length;
    const lossNote =
      losses > 0 && !opts.force
        ? ` ${losses} file(s) would lose repo content and are NOT overwritten without \`--force\` (see Losses).`
        : "";
    out.push(
      `Approve? Apply the ${plan.selected.length} recipe(s) above: phase 1 writes every file, phase 2 runs every command, phase 3 runs every verify.${lossNote}`,
    );
  }
  return out.join("\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  let report;
  try {
    report = runDetector(opts.projectDir);
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
    for (const r of report.recipes) process.stderr.write(`  { id: "${r.id}", error: ${JSON.stringify(r.error)} }\n`);
    process.exit(1);
  }

  const plan = buildPlan(report, opts);
  process.stdout.write(renderPlan(plan, opts));
}

try {
  main();
} catch (err) {
  process.stderr.write(`plan.mjs: ${err.message}\n`);
  process.exit(1);
}
