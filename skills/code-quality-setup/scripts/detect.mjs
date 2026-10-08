#!/usr/bin/env node
// detect.mjs — the code-quality-setup stack detector.
//
// Zero dependencies, node builtins only. Reads a project from the filesystem and prints a JSON
// applicability matrix: the stack, the existing tooling per package, and every known recipe's
// evaluated `when` result with the reason it passed or failed. It never invokes a package manager
// and never writes anything.
//
// Usage: node scripts/detect.mjs [projectDir] [--compact]
//
// The output shape is specified in DETECT-SCHEMA.md next to this file; the recipe frontmatter it
// reads is specified in ../RECIPE-CONTRACT.md.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECIPES_DIR = join(SKILL_DIR, "references", "recipes");

// ---------------------------------------------------------------------------
// 1. Strict-subset frontmatter reader (RECIPE-CONTRACT.md → "Reader rules")
// ---------------------------------------------------------------------------

// Flow-style values are JSON with the quotes left off. Quote the bare tokens, then JSON.parse.
function parseFlow(src) {
  const quoted = src
    .replace(/([{,]\s*)([A-Za-z_][\w.-]*)\s*:/g, '$1"$2":')
    .replace(/:\s*([^"'\s,[\]{}][^,}\]]*?)\s*(?=[,}])/g, (_m, w) => `: ${JSON.stringify(w)}`)
    .replace(/([[,]\s*)([^"'\s,[\]{}][^,}\]]*?)\s*(?=[,\]])/g, (_m, p, w) => `${p}${JSON.stringify(w)}`);
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

// `{{plan.details}}` renders each selected recipe's undo bullets. A missing or empty section is a
// hard error: a silent blank renders an empty "Undo:" in the guidance doc.
function extractUndo(body, label) {
  const m = /^## Undo\s*$([\s\S]*?)(?=^## |\s*$(?![\s\S]))/m.exec(body);
  if (!m) throw new Error(`${label}: no "## Undo" section`);
  const bullets = m[1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
  if (bullets.length === 0) throw new Error(`${label}: "## Undo" section is empty`);
  return bullets;
}

// A malformed recipe is reported, never fatal: one broken file must not cost the user the whole
// matrix. Its entry carries `id` and `error` and nothing else, and it is never selected.
function loadRecipes() {
  if (!existsSync(RECIPES_DIR)) throw new Error(`no recipe directory at ${RECIPES_DIR}`);
  const files = readdirSync(RECIPES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  return files.map((file) => {
    const stem = basename(file, ".md");
    const label = `references/recipes/${file}`;
    try {
      const text = readFileSync(join(RECIPES_DIR, file), "utf8");
      const fm = parseFrontmatter(text, label);
      if (fm.id !== stem) throw new Error(`${label}: id "${fm.id}" must equal the filename stem`);
      if (!/^[a-z][a-z0-9-]*$/.test(fm.id)) throw new Error(`${label}: id "${fm.id}" is not kebab-case`);
      const body = text.slice(text.indexOf("\n---", 3) + 4);
      return {
        id: fm.id,
        error: null,
        title: fm.title ?? fm.id,
        purpose: fm.purpose ?? "",
        when: fm.when ?? {},
        conflicts: fm.conflicts ?? {},
        cost: fm.cost ?? "fast",
        priority: fm.priority ?? 0,
        files: fm.files ?? [],
        commands: fm.commands ?? [],
        gates: fm.gates ?? [],
        verify: fm.verify ?? [],
        undo: extractUndo(body, label),
      };
    } catch (err) {
      return { id: stem, error: err.message };
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Filesystem helpers
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".turbo", ".cache",
  ".stryker-tmp", "reports", "vendor", ".venv", "__pycache__",
]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// Bounded walk: returns paths relative to `dir`, skipping the usual build/vendor directories and
// every dot-directory. Dot-directories are tooling, not project source — and the installed skill
// itself lives in one (`.agents/skills/code-quality-setup/`), so walking into them would report
// `javascript: true` for a repo whose only `.mjs` is this script.
function walk(dir, { maxDepth = 6, maxEntries = 20000 } = {}) {
  const out = [];
  const queue = [{ abs: dir, rel: "", depth: 0 }];
  while (queue.length > 0 && out.length < maxEntries) {
    const { abs, rel, depth } = queue.shift();
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".") || depth >= maxDepth) continue;
        queue.push({ abs: join(abs, e.name), rel: childRel, depth: depth + 1 });
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  }
  return out;
}

// `*` = one path segment, `**` = any depth, leading `!` = exclude.
function globToRegExp(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        re += ".*";
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

function expandMemberGlobs(root, patterns) {
  const includes = patterns.filter((p) => !p.startsWith("!")).map((p) => globToRegExp(p));
  const excludes = patterns.filter((p) => p.startsWith("!")).map((p) => globToRegExp(p.slice(1)));
  const dirs = [];
  const queue = [{ abs: root, rel: "", depth: 0 }];
  while (queue.length > 0) {
    const { abs, rel, depth } = queue.shift();
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".") || depth >= 4) continue;
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
      queue.push({ abs: join(abs, e.name), rel: childRel, depth: depth + 1 });
      if (!includes.some((r) => r.test(childRel))) continue;
      if (excludes.some((r) => r.test(childRel))) continue;
      if (isFile(join(abs, e.name, "package.json"))) dirs.push(childRel);
    }
  }
  return dirs.sort();
}

// Minimal reader for `pnpm-workspace.yaml` — only the `packages:` list is needed.
function readPnpmWorkspace(path) {
  const text = readText(path);
  if (text === null) return null;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^packages\s*:/.test(l));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const m = /^\s+-\s*(.+?)\s*$/.exec(line);
    if (!m) break;
    out.push(m[1].replace(/^['"]|['"]$/g, ""));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Stack detection
// ---------------------------------------------------------------------------

const LOCKFILES = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
];

function detectPackageManager(root, rootManifest) {
  for (const [file, name] of LOCKFILES) {
    if (isFile(join(root, file))) return { name, source: "lockfile", evidence: file };
  }
  const declared = rootManifest?.packageManager;
  if (typeof declared === "string" && declared !== "") {
    return { name: declared.split("@")[0], source: "packageManager-field", evidence: `package.json#packageManager = ${declared}` };
  }
  return { name: null, source: null, evidence: null };
}

// `rootPrefix` is the relative path from the member back to the workspace root (`../..` for
// `packages/a`), the value a `memberMode: extends-root` stub substitutes for `{{root}}`. The
// detector reports it so the renderer never does path arithmetic (RECIPE-CONTRACT.md → Substitution).
function memberEntry(root, path) {
  const rootPrefix = path
    .split("/")
    .map(() => "..")
    .join("/");
  return { path, name: readJson(join(root, path, "package.json"))?.name ?? null, rootPrefix };
}

function detectWorkspace(root, rootManifest, manager) {
  const pnpmFile = join(root, "pnpm-workspace.yaml");
  if (isFile(pnpmFile)) {
    const patterns = readPnpmWorkspace(pnpmFile) ?? [];
    const members = expandMemberGlobs(root, patterns).map((path) => memberEntry(root, path));
    return { kind: members.length > 0 ? "workspace" : "single", declaration: "pnpm-workspace.yaml", patterns, members };
  }
  const ws = rootManifest?.workspaces;
  const patterns = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : null;
  if (patterns && patterns.length > 0) {
    const members = expandMemberGlobs(root, patterns).map((path) => memberEntry(root, path));
    return { kind: members.length > 0 ? "workspace" : "single", declaration: "package.json#workspaces", patterns, members };
  }
  return { kind: "single", declaration: null, patterns: [], members: [] };
}

// `extends` chains are followed for relative specifiers only; a package specifier needs
// node_modules, which the detector never reads. `strict` is null when nothing in the chain states
// it — a solution-style root (`files: []` + `references`) states nothing, and reporting that as
// "not strict" would be a lie.
function resolveTsconfigFile(file, base, seen) {
  if (!isFile(file) || seen.has(file)) return null;
  seen.add(file);
  const rel = relative(base, file) || basename(file);
  const cfg = readJson(file);
  if (!cfg) {
    return { configFile: rel, strict: null, strictSource: null, solutionStyle: false, unresolvedExtends: [`${rel} is not valid JSON`] };
  }

  let inherited = null;
  const unresolvedExtends = [];
  const ext = cfg.extends;
  for (const spec of Array.isArray(ext) ? ext : ext ? [ext] : []) {
    if (typeof spec !== "string") continue;
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const target = resolve(dirname(file), spec);
      const parent = resolveTsconfigFile(tsconfigTarget(target), base, seen);
      if (parent) inherited = { ...(inherited ?? {}), ...parent };
    } else {
      unresolvedExtends.push(spec);
    }
  }

  const own = cfg.compilerOptions ?? {};
  const solutionStyle = Object.keys(own).length === 0 && Array.isArray(cfg.references) && cfg.references.length > 0;
  return {
    configFile: rel,
    strict: typeof own.strict === "boolean" ? own.strict : (inherited?.strict ?? null),
    strictSource: typeof own.strict === "boolean" ? rel : (inherited?.strictSource ?? null),
    solutionStyle,
    unresolvedExtends: [...unresolvedExtends, ...(inherited?.unresolvedExtends ?? [])],
  };
}

// `extends` may name a directory (→ its tsconfig.json) or a file with the extension left off.
function tsconfigTarget(target) {
  if (isDir(target)) return join(target, "tsconfig.json");
  if (isFile(target)) return target;
  return isFile(`${target}.json`) ? `${target}.json` : target;
}

function resolveTsconfig(dir, base = dir) {
  return resolveTsconfigFile(join(dir, "tsconfig.json"), base, new Set());
}

function detectLanguages(root, rootManifest, tsconfig) {
  const files = walk(root);
  const exts = new Set();
  for (const f of files) {
    const dot = f.lastIndexOf(".");
    if (dot !== -1) exts.add(f.slice(dot));
  }
  const hasTs = [...exts].some((e) => [".ts", ".tsx", ".mts", ".cts"].includes(e));
  const hasJs = [...exts].some((e) => [".js", ".jsx", ".mjs", ".cjs"].includes(e));
  const deps = { ...(rootManifest?.dependencies ?? {}), ...(rootManifest?.devDependencies ?? {}) };
  return {
    typescript: hasTs || "typescript" in deps || tsconfig !== null,
    javascript: hasJs,
    sourceExtensions: [...exts].filter((e) => SOURCE_EXT.has(e)).sort(),
  };
}

// A solution-style root states no strictness of its own, so the project's answer comes from the
// packages that do state one.
function aggregateStrictness(rootTsconfig, packages) {
  if (rootTsconfig && typeof rootTsconfig.strict === "boolean") {
    return { value: rootTsconfig.strict, source: rootTsconfig.configFile };
  }
  const stated = packages.map((p) => p.typescript?.strict).filter((s) => typeof s === "boolean");
  if (stated.length === 0) return { value: "unknown", source: null };
  if (stated.every(Boolean)) return { value: true, source: "members" };
  if (stated.every((s) => !s)) return { value: false, source: "members" };
  return { value: "mixed", source: "members" };
}

// ---------------------------------------------------------------------------
// 4. Existing tooling, per package
// ---------------------------------------------------------------------------

const TOOLING = {
  formatter: [
    ["biome", ["biome.json", "biome.jsonc"]],
    ["prettier", [".prettierrc", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml", ".prettierrc.json5", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.mjs", ".prettierrc.toml", "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs", "prettier.config.ts"]],
    ["dprint", ["dprint.json", ".dprint.json", "dprint.jsonc"]],
  ],
  linter: [
    ["biome", ["biome.json", "biome.jsonc"]],
    ["eslint", [".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts"]],
    ["oxlint", [".oxlintrc", ".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts", "oxlint.config.js", "oxlint.config.mjs"]],
  ],
  typechecker: [
    ["typescript", ["tsconfig.json", "tsconfig.base.json", "tsconfig.settings.json", "jsconfig.json"]],
  ],
  testRunner: [
    ["vitest", ["vitest.config.ts", "vitest.config.js", "vitest.config.mts", "vitest.config.mjs", "vitest.workspace.ts", "vitest.workspace.js", "vitest.projects.ts"]],
    ["jest", ["jest.config.js", "jest.config.ts", "jest.config.cjs", "jest.config.mjs", "jest.config.json"]],
    ["bun-test", ["bunfig.toml"]],
  ],
  mutation: [
    ["stryker", ["stryker.conf.json", "stryker.conf.js", "stryker.conf.mjs", "stryker.conf.cjs", "stryker.config.json", "stryker.config.js", "stryker.config.mjs", ".strykerrc", ".strykerrc.json"]],
  ],
  gitHooks: [
    ["husky", [".husky"]],
    ["lefthook", ["lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml"]],
    ["pre-commit", [".pre-commit-config.yaml", ".pre-commit-config.yml"]],
    ["simple-git-hooks", ["simple-git-hooks.json"]],
  ],
  ci: [
    ["github-actions", [".github/workflows"]],
    ["gitlab-ci", [".gitlab-ci.yml"]],
    ["circleci", [".circleci/config.yml"]],
  ],
};

// Coverage has no config file of its own in the common setups: it is a key inside the test
// runner's config, or a dedicated rc file.
const COVERAGE_RC = [".nycrc", ".nycrc.json", ".nycrc.yml", ".nycrc.yaml", ".c8rc", ".c8rc.json"];
const COVERAGE_HOSTS = [
  "vitest.config.ts", "vitest.config.js", "vitest.config.mts", "vitest.config.mjs",
  "jest.config.js", "jest.config.ts", "jest.config.cjs", "jest.config.mjs", "jest.config.json",
  "bunfig.toml",
];

function detectTooling(dir) {
  const found = {};
  for (const [category, table] of Object.entries(TOOLING)) {
    const hits = [];
    for (const [tool, candidates] of table) {
      const files = [];
      for (const c of candidates) {
        const abs = join(dir, c);
        if (isDir(abs)) {
          const inner = readdirSync(abs).filter((n) => !n.startsWith(".")).sort();
          files.push(...(inner.length > 0 ? inner.map((n) => `${c}/${n}`) : [`${c}/`]));
        } else if (isFile(abs)) {
          files.push(c);
        }
      }
      if (files.length > 0) hits.push({ tool, files });
    }
    found[category] = hits;
  }

  const coverage = [];
  for (const c of COVERAGE_RC) if (isFile(join(dir, c))) coverage.push({ tool: c.replace(/^\./, "").replace(/rc.*$/, ""), files: [c] });
  for (const c of COVERAGE_HOSTS) {
    const text = readText(join(dir, c));
    if (text !== null && /\bcoverage\b/.test(text)) coverage.push({ tool: c.split(".")[0], files: [c] });
  }
  found.coverage = coverage;

  const gitHooksDir = join(dir, ".git", "hooks");
  if (isDir(gitHooksDir)) {
    const live = readdirSync(gitHooksDir).filter((n) => !n.endsWith(".sample")).sort();
    if (live.length > 0) found.gitHooks.push({ tool: "git-hooks-path", files: live.map((n) => `.git/hooks/${n}`) });
  }
  return found;
}

function readPackage(dir, relPath, role) {
  const manifest = readJson(join(dir, "package.json"));
  const deps = { ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) };
  return {
    path: relPath,
    name: manifest?.name ?? null,
    role,
    hasManifest: manifest !== null,
    scripts: Object.keys(manifest?.scripts ?? {}).sort(),
    dependencies: Object.keys(deps).sort(),
    typescript: resolveTsconfig(dir),
    tooling: detectTooling(dir),
  };
}

// ---------------------------------------------------------------------------
// 5. `when` evaluation
// ---------------------------------------------------------------------------

function predicateHolds(pred, ctx) {
  if (pred === null || typeof pred !== "object") return { pass: false, detail: `unreadable predicate ${JSON.stringify(pred)}` };
  if ("file" in pred) {
    const ok = existsSync(join(ctx.root, pred.file));
    return { pass: ok, detail: `${pred.file} ${ok ? "exists" : "is absent"} at the workspace root` };
  }
  if ("dep" in pred) {
    const owners = ctx.packages.filter((p) => p.dependencies.includes(pred.dep)).map((p) => p.path);
    return { pass: owners.length > 0, detail: owners.length > 0 ? `${pred.dep} declared in ${owners.join(", ")}` : `${pred.dep} is not declared in any manifest` };
  }
  if ("script" in pred) {
    const ok = ctx.rootPackage.scripts.includes(pred.script);
    return { pass: ok, detail: `root package.json ${ok ? "has" : "has no"} script "${pred.script}"` };
  }
  if ("recipe" in pred) {
    if (pred.recipe === "*") {
      const others = [...ctx.selection].filter((id) => id !== ctx.recipeId);
      return { pass: others.length > 0, detail: others.length > 0 ? `other recipes selected: ${others.join(", ")}` : "no other recipe is selected" };
    }
    const ok = ctx.selection.has(pred.recipe);
    return { pass: ok, detail: `recipe "${pred.recipe}" ${ok ? "is" : "is not"} selected` };
  }
  return { pass: false, detail: `unknown predicate ${JSON.stringify(pred)}` };
}

function evaluateWhen(recipe, ctx) {
  const when = recipe.when ?? {};
  const reasons = [];
  const push = (predicate, pass, detail) => reasons.push({ predicate, pass, detail });

  if (when.language) {
    const hit = when.language.filter((l) => ctx.languages[l]);
    push("language", hit.length > 0, `needs one of [${when.language.join(", ")}]; detected ${hit.length > 0 ? hit.join(", ") : "none"}`);
  }
  if (when.packageManager) {
    const hit = when.packageManager.includes(ctx.packageManager.name);
    push("packageManager", hit, `needs one of [${when.packageManager.join(", ")}]; detected ${ctx.packageManager.name ?? "none"}`);
  }
  if (when.workspace && when.workspace !== "any") {
    const hit = when.workspace === ctx.workspace.kind;
    push("workspace", hit, `needs workspace "${when.workspace}"; detected "${ctx.workspace.kind}"`);
  }
  for (const pred of when.requires ?? []) {
    const { pass, detail } = predicateHolds(pred, ctx);
    push(`requires ${JSON.stringify(pred)}`, pass, detail);
  }
  for (const pred of when.excludes ?? []) {
    const { pass, detail } = predicateHolds(pred, ctx);
    push(`excludes ${JSON.stringify(pred)}`, !pass, pass ? `excluded by ${detail}` : `not excluded (${detail})`);
  }
  return { applicable: reasons.every((r) => r.pass), reasons };
}

// Selection is a fixpoint: `requires: [{ recipe: X }]` makes applicability depend on the selection,
// and `conflicts.recipes` can remove a recipe another one requires. Grow, then shrink, until stable.
function selectRecipes(recipes, ctx) {
  const usable = recipes.filter((r) => r.error === null);
  const byId = new Map(usable.map((r) => [r.id, r]));
  const base = new Set();
  for (const r of usable) {
    const { applicable } = evaluateWhen(r, { ...ctx, selection: new Set(), recipeId: r.id });
    if (applicable) base.add(r.id);
  }

  const selection = new Set(base);
  for (let guard = 0; guard < usable.length + 2; guard++) {
    let changed = false;
    for (const r of usable) {
      if (selection.has(r.id)) continue;
      const { applicable } = evaluateWhen(r, { ...ctx, selection, recipeId: r.id });
      if (applicable) {
        selection.add(r.id);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const heldBack = [];
  for (let guard = 0; guard < usable.length + 2; guard++) {
    let changed = false;
    for (const id of [...selection]) {
      // The snapshot is taken before the pass; a recipe dropped earlier in it must not be
      // processed again, or a mutual conflict records the same loser twice.
      if (!selection.has(id)) continue;
      const r = byId.get(id);
      for (const other of r.conflicts?.recipes ?? []) {
        if (!selection.has(other)) continue;
        const o = byId.get(other);
        const loser = (o.priority ?? 0) > (r.priority ?? 0) ? r : o;
        const winner = loser === r ? o : r;
        selection.delete(loser.id);
        heldBack.push({ id: loser.id, reason: `conflicts with "${winner.id}" (priority ${winner.priority ?? 0} > ${loser.priority ?? 0})` });
        changed = true;
      }
    }
    for (const id of [...selection]) {
      const r = byId.get(id);
      const { applicable } = evaluateWhen(r, { ...ctx, selection, recipeId: r.id });
      if (!applicable) {
        selection.delete(id);
        heldBack.push({ id, reason: "a recipe it requires is no longer selected" });
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { selection, heldBack };
}

// Project-local evidence only: a dependency or a config file in the repo. A binary on PATH is not a
// property of the project, so the same repo would collide on one machine and not another.
function detectToolCollisions(recipes, selection, ctx) {
  const collisions = [];
  for (const r of recipes) {
    if (r.error !== null || !selection.has(r.id)) continue;
    for (const tool of r.conflicts?.tools ?? []) {
      const evidence = [];
      for (const p of ctx.packages) {
        const where = p.path === "." ? "root" : p.path;
        if (p.dependencies.includes(tool)) evidence.push(`${where}/package.json declares ${tool}`);
        for (const [category, hits] of Object.entries(p.tooling)) {
          for (const h of hits) if (h.tool === tool) evidence.push(`${where} ${category}: ${h.files.join(", ")}`);
        }
      }
      if (evidence.length > 0) collisions.push({ recipe: r.id, tool, evidence });
    }
  }
  return collisions;
}

// ---------------------------------------------------------------------------
// 6. Report
// ---------------------------------------------------------------------------

function detect(projectDir) {
  const root = resolve(projectDir);
  if (!isDir(root)) throw new Error(`not a directory: ${root}`);
  const rootManifest = readJson(join(root, "package.json"));
  const packageManager = detectPackageManager(root, rootManifest);
  const workspace = detectWorkspace(root, rootManifest, packageManager.name);
  const rootTsconfig = resolveTsconfig(root);

  const rootPackage = readPackage(root, ".", "root");
  const packages = [rootPackage];
  for (const m of workspace.members) packages.push(readPackage(join(root, m.path), m.path, "member"));

  const languages = detectLanguages(root, rootManifest, rootTsconfig);
  const strictness = aggregateStrictness(rootTsconfig, packages);
  languages.typescriptStrict = languages.typescript ? strictness.value : null;
  languages.typescriptStrictSource = languages.typescript ? strictness.source : null;
  languages.tsconfig = rootTsconfig?.configFile ?? null;

  const recipes = loadRecipes();
  const ctx = {
    root,
    languages,
    packageManager,
    workspace,
    packages,
    rootPackage,
    selection: new Set(),
    recipeId: null,
  };

  const { selection, heldBack } = selectRecipes(recipes, ctx);
  const collisions = detectToolCollisions(recipes, selection, ctx);

  const matrix = recipes.map((r) => {
    if (r.error !== null) return { id: r.id, error: r.error };
    const { applicable, reasons } = evaluateWhen(r, { ...ctx, selection, recipeId: r.id });
    return {
      id: r.id,
      error: null,
      title: r.title,
      purpose: r.purpose,
      cost: r.cost,
      priority: r.priority,
      applicable,
      selected: selection.has(r.id),
      reasons,
      files: r.files,
      commands: r.commands,
      gates: r.gates,
      verify: r.verify,
      undo: r.undo,
      conflicts: r.conflicts,
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    root,
    stack: { languages, packageManager, workspace },
    packages,
    recipes: matrix,
    selection: [...selection].sort((a, b) => (recipes.find((r) => r.id === b).priority ?? 0) - (recipes.find((r) => r.id === a).priority ?? 0)),
    heldBack,
    collisions,
  };
}

const args = process.argv.slice(2);
const compact = args.includes("--compact");
const target = args.find((a) => !a.startsWith("--")) ?? ".";
try {
  const report = detect(target);
  process.stdout.write(`${JSON.stringify(report, null, compact ? 0 : 2)}\n`);
} catch (err) {
  process.stderr.write(`detect.mjs: ${err.message}\n`);
  process.exit(1);
}
