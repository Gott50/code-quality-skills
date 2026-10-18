#!/usr/bin/env node
// detect.mjs — the code-quality-setup stack detector.
//
// Zero dependencies, node builtins only. Reads a project from the filesystem and prints a JSON
// applicability matrix: the stack, the existing tooling per package, and every known recipe's and
// practice's evaluated `when` result with the reason it passed or failed. It never invokes a
// package manager and never writes anything.
//
// Usage: node scripts/detect.mjs [projectDir] [--library <path>] [--compact]
//
// The output shape is specified in DETECT-SCHEMA.md next to this file; the recipe and practice
// frontmatter it reads is specified in the library's RECIPE-CONTRACT.md (library/RECIPE-CONTRACT.md).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./frontmatter.mjs";

const SCHEMA_VERSION = 1;
const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The library lives at the repo root, two levels up from the skill dir (skills/code-quality-setup/).
// This is the repo-layout default; the fetched cache (fetch.mjs) supplies its `libraryDir` through
// `--library` or $CODE_QUALITY_LIBRARY instead.
const DEFAULT_LIBRARY_DIR = resolve(SKILL_DIR, "..", "..", "library");

// The library directory to read recipes from: `--library <path>`, else $CODE_QUALITY_LIBRARY, else
// the repo-layout default. Resolved to an absolute path so a relative flag reads from the cwd.
function resolveLibraryDir(flag) {
  return resolve(flag ?? process.env.CODE_QUALITY_LIBRARY ?? DEFAULT_LIBRARY_DIR);
}

// The gates a recipe's gate entry may name in `floor:` (RECIPE-CONTRACT.md →
// "`floor` — the gate's ratchet"): the four unified-baseline gates, or
// fallow's own two. A static string-keyed membership table.
const FLOOR_GATES = {
  coverage: true,
  "dep-audit": true,
  "fallow-dead-code": true,
  "fallow-health": true,
  lint: true,
  mutation: true,
  typecheck: true,
};

// ---------------------------------------------------------------------------
// 1. Strict-subset frontmatter reader — shared with scripts/build-library.mjs
// ---------------------------------------------------------------------------
//
// The reader lives in ./frontmatter.mjs (RECIPE-CONTRACT.md → "Reader rules"); detect.mjs and the
// repo-root library generator import the same copy so the two never drift.

// `{{plan.details}}` renders each selected recipe's undo bullets. A missing or empty section is a
// hard error: a silent blank renders an empty "Undo:" in the guidance doc.
function extractUndo(body, label) {
  const m = /^## Undo\s*$([\s\S]*?)(?=^## |\s*$(?![\s\S]))/m.exec(body);
  if (!m) throw new Error(`${label}: no "## Undo" section`);
  // A bullet may wrap onto continuation lines: any non-blank line that does not open a new `- `
  // bullet belongs to the bullet above it, joined with a single space. Dropping those lines would
  // silently truncate the rendered bullet.
  const bullets = [];
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("- ")) bullets.push(line.slice(2).trim());
    else if (line !== "" && bullets.length > 0) bullets[bullets.length - 1] += ` ${line}`;
  }
  if (bullets.length === 0) throw new Error(`${label}: "## Undo" section is empty`);
  return bullets;
}

// A malformed recipe is reported, never fatal: one broken file must not cost the user the whole
// matrix. Its entry carries `id` and `error` and nothing else, and it is never selected.
//
// `dir` is a library-shaped directory: `<dir>/recipes/*.md`. The remote library is required; the
// project-local `.code-quality/` layer is optional (`optional: true` returns `[]` when it is
// absent). `source` labels the layer ("library" or "local") and is carried on every entry, along
// with `libraryDir` — the absolute directory the recipe was loaded from, which the plan and the
// proposal reader use to resolve the recipe's own templates.
function loadRecipes(dir, { optional = false, source = "library" } = {}) {
  const recipesDir = join(dir, "recipes");
  if (!existsSync(recipesDir)) {
    if (optional) return [];
    throw new Error(`no recipe directory at ${recipesDir}`);
  }
  const files = readdirSync(recipesDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  return files.map((file) => {
    const stem = basename(file, ".md");
    const label = `${source === "local" ? ".code-quality" : "library"}/recipes/${file}`;
    try {
      const text = readFileSync(join(recipesDir, file), "utf8");
      const fm = parseFrontmatter(text, label);
      if (fm.id !== stem) throw new Error(`${label}: id "${fm.id}" must equal the filename stem`);
      if (!/^[a-z][a-z0-9-]*$/.test(fm.id))
        throw new Error(`${label}: id "${fm.id}" is not kebab-case`);
      // A gate's `floor` names the baseline gate its level is floored by;
      // anything else is a frontmatter rule violation, not a typo to run
      // with.
      for (const gate of fm.gates ?? []) {
        if (gate.floor != null && !Object.hasOwn(FLOOR_GATES, gate.floor)) {
          throw new Error(
            `${label}: gate "${gate.id}" floor "${gate.floor}" is not a known floor gate`,
          );
        }
      }
      // A marker `merge` template MUST carry its own marker pair (RECIPE-CONTRACT.md → files:
      // "Every merged block is attributable to its recipe"). The detector reads frontmatter and
      // normally never opens a template; this is the one template rule it enforces, because a
      // marker merge whose marker is missing — or names another recipe — writes an unowned block
      // into a shared file, which is the failure the marker exists to prevent.
      //
      // The discriminator is the plan's own `mergeKind`: a merge is a marker merge unless the
      // target is a `.json` file, where `merge` means "add the fragment's leaves" and the template
      // is a structural fragment with no marker. A template that is absent is not this check's
      // business (the plan reports it), and a per-practice entry names no literal file.
      for (const f of fm.files ?? []) {
        if (f.action !== "merge") continue;
        if (!f.template || f.template.includes("{{practice.id}}")) continue;
        if ((f.path ?? "").endsWith(".json")) continue;
        let template;
        try {
          template = readFileSync(join(dir, f.template), "utf8");
        } catch {
          continue;
        }
        for (const edge of ["start", "end"]) {
          const marker = `code-quality:${fm.id}:${edge}`;
          if (!template.includes(marker)) {
            throw new Error(`${label}: merge template "${f.template}" has no "${marker}" marker`);
          }
        }
      }
      const body = text.slice(text.indexOf("\n---", 3) + 4);
      return {
        commands: fm.commands ?? [],
        conflicts: fm.conflicts ?? {},
        cost: fm.cost ?? "fast",
        error: null,
        files: fm.files ?? [],
        gates: fm.gates ?? [],
        id: fm.id,
        libraryDir: dir,
        priority: fm.priority ?? 0,
        purpose: fm.purpose ?? "",
        source,
        title: fm.title ?? fm.id,
        undo: extractUndo(body, label),
        verify: fm.verify ?? [],
        when: fm.when ?? {},
      };
    } catch (err) {
      return { error: err.message, id: stem, libraryDir: dir, source };
    }
  });
}

// A practice is one file at `<dir>/practices/<id>.md` (RECIPE-CONTRACT.md → "Practices"). The
// directory is optional in both layers: a library or project with no practices is valid, so an
// absent `<dir>/practices/` is an empty list, never an error. A malformed practice is reported,
// never fatal, and never selected — the same rule as a recipe.
//
// `layer` labels the source ("library" or "local"). A practice's own `source` frontmatter key is
// the research note, so it is carried as `source`; the layer is `layer`, not `source` the way a
// recipe's layer is.
function loadPractices(dir, { layer = "library" } = {}) {
  const practicesDir = join(dir, "practices");
  if (!existsSync(practicesDir)) return [];
  const files = readdirSync(practicesDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  return files.map((file) => {
    const stem = basename(file, ".md");
    const label = `${layer === "local" ? ".code-quality" : "library"}/practices/${file}`;
    try {
      const fm = parseFrontmatter(readFileSync(join(practicesDir, file), "utf8"), label);
      if (fm.id !== stem) throw new Error(`${label}: id "${fm.id}" must equal the filename stem`);
      if (!/^[a-z][a-z0-9-]*$/.test(fm.id))
        throw new Error(`${label}: id "${fm.id}" is not kebab-case`);
      return {
        enforcedBy: fm.enforcedBy ?? [],
        error: null,
        id: fm.id,
        layer,
        libraryDir: dir,
        source: fm.source ?? "",
        title: fm.title ?? fm.id,
        when: fm.when ?? {},
      };
    } catch (err) {
      return { error: err.message, id: stem, layer, libraryDir: dir };
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Filesystem helpers
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  ".stryker-tmp",
  "reports",
  "vendor",
  ".venv",
  "__pycache__",
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
  const queue = [{ abs: dir, depth: 0, rel: "" }];
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
        queue.push({ abs: join(abs, e.name), depth: depth + 1, rel: childRel });
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  }
  return out;
}

// The standard test-file naming convention: `*.test.*` / `*.spec.*`, plus bun's `*_test.*` /
// `*_spec.*` — the union of bun's and vitest's discovery patterns.
const TEST_FILE = /(?:\.|_)(?:test|spec)\.[cm]?[jt]sx?$/;

// Whether the project has any test file, by that convention. `walk` already skips dot-directories
// and `node_modules` — the installed skill itself lives in a dot-directory, and a test file inside
// it is not the project's — so this is the same notion of "the project's files" the language
// detection uses. A recipe whose gate runs a test runner (mutation, coverage) is not applicable to
// a repo with nothing to run: the runner exits non-zero on an empty test set.
//
// Memoized: the predicate is evaluated once per recipe per selection pass (the fixpoint grows and
// shrinks), and the walk is the expensive part.
const testFileCache = new Map();
function hasTestFiles(root) {
  let hit = testFileCache.get(root);
  if (hit === undefined) {
    hit = walk(root).some((f) => TEST_FILE.test(f));
    testFileCache.set(root, hit);
  }
  return hit;
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
  const queue = [{ abs: root, depth: 0, rel: "" }];
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
      queue.push({ abs: join(abs, e.name), depth: depth + 1, rel: childRel });
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
    if (isFile(join(root, file))) return { evidence: file, name, source: "lockfile" };
  }
  const declared = rootManifest?.packageManager;
  if (typeof declared === "string" && declared !== "") {
    return {
      evidence: `package.json#packageManager = ${declared}`,
      name: declared.split("@")[0],
      source: "packageManager-field",
    };
  }
  return { evidence: null, name: null, source: null };
}

// `rootPrefix` is the relative path from the member back to the workspace root (`../..` for
// `packages/a`), the value a `memberMode: extends-root` stub substitutes for `{{root}}`. The
// detector reports it so the renderer never does path arithmetic (RECIPE-CONTRACT.md → Substitution).
function memberEntry(root, path) {
  const rootPrefix = path
    .split("/")
    .map(() => "..")
    .join("/");
  return { name: readJson(join(root, path, "package.json"))?.name ?? null, path, rootPrefix };
}

function detectWorkspace(root, rootManifest, manager) {
  const pnpmFile = join(root, "pnpm-workspace.yaml");
  if (isFile(pnpmFile)) {
    const patterns = readPnpmWorkspace(pnpmFile) ?? [];
    const members = expandMemberGlobs(root, patterns).map((path) => memberEntry(root, path));
    return {
      declaration: "pnpm-workspace.yaml",
      kind: members.length > 0 ? "workspace" : "single",
      members,
      patterns,
    };
  }
  const ws = rootManifest?.workspaces;
  const patterns = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : null;
  if (patterns && patterns.length > 0) {
    const members = expandMemberGlobs(root, patterns).map((path) => memberEntry(root, path));
    return {
      declaration: "package.json#workspaces",
      kind: members.length > 0 ? "workspace" : "single",
      members,
      patterns,
    };
  }
  return { declaration: null, kind: "single", members: [], patterns: [] };
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
    return {
      compilerOptions: {},
      configFile: rel,
      solutionStyle: false,
      strict: null,
      strictSource: null,
      unresolvedExtends: [`${rel} is not valid JSON`],
    };
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
  const solutionStyle =
    Object.keys(own).length === 0 && Array.isArray(cfg.references) && cfg.references.length > 0;
  return {
    // The effective compiler options, own over inherited: the `{ tsconfig: <option> }` predicate
    // reads one of them, and `strict` implies the strict-mode family (see `tsconfigOption`).
    compilerOptions: { ...(inherited?.compilerOptions ?? {}), ...own },
    configFile: rel,
    solutionStyle,
    strict: typeof own.strict === "boolean" ? own.strict : (inherited?.strict ?? null),
    strictSource: typeof own.strict === "boolean" ? rel : (inherited?.strictSource ?? null),
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
    javascript: hasJs,
    sourceExtensions: [...exts].filter((e) => SOURCE_EXT.has(e)).sort(),
    typescript: hasTs || "typescript" in deps || tsconfig !== null,
  };
}

// A solution-style root states no strictness of its own, so the project's answer comes from the
// packages that do state one.
function aggregateStrictness(rootTsconfig, packages) {
  if (rootTsconfig && typeof rootTsconfig.strict === "boolean") {
    return { source: rootTsconfig.configFile, value: rootTsconfig.strict };
  }
  const stated = packages.map((p) => p.typescript?.strict).filter((s) => typeof s === "boolean");
  if (stated.length === 0) return { source: null, value: "unknown" };
  if (stated.every(Boolean)) return { source: "members", value: true };
  if (stated.every((s) => !s)) return { source: "members", value: false };
  return { source: "members", value: "mixed" };
}

// The strict-mode family: `strict: true` turns each of these on, so a predicate that names one of
// them holds when the chain states `strict` rather than the option itself.
const STRICT_FAMILY = new Set([
  "alwaysStrict",
  "noImplicitAny",
  "noImplicitThis",
  "strictBindCallApply",
  "strictFunctionTypes",
  "strictNullChecks",
  "strictPropertyInitialization",
  "useUnknownInCatchVariables",
]);

// The effective value of one compiler option, as the chain states it: the option itself when the
// chain states it, otherwise `strict` for a member of the strict-mode family. `null` when nothing
// in the chain states either — the same "nothing stated" answer `strict` gets, because reporting
// that as `false` would be a lie.
function tsconfigOption(tsconfig, option) {
  if (!tsconfig) return null;
  const options = tsconfig.compilerOptions ?? {};
  if (typeof options[option] === "boolean") return options[option];
  if (STRICT_FAMILY.has(option) && typeof options.strict === "boolean") return options.strict;
  return null;
}

// A solution-style root states no options of its own, so the project's answer comes from the
// packages that do state one — the same aggregation `aggregateStrictness` makes for `strict`.
function aggregateOption(rootTsconfig, packages, option) {
  const root = tsconfigOption(rootTsconfig, option);
  if (root !== null) return { source: rootTsconfig.configFile, value: root };
  const stated = packages
    .map((p) => tsconfigOption(p.typescript, option))
    .filter((v) => v !== null);
  if (stated.length === 0) return { source: null, value: null };
  if (stated.every(Boolean)) return { source: "members", value: true };
  if (stated.every((v) => !v)) return { source: "members", value: false };
  return { source: "members", value: "mixed" };
}

// ---------------------------------------------------------------------------
// 4. Existing tooling, per package
// ---------------------------------------------------------------------------

const TOOLING = {
  ci: [
    ["github-actions", [".github/workflows"]],
    ["gitlab-ci", [".gitlab-ci.yml"]],
    ["circleci", [".circleci/config.yml"]],
  ],
  formatter: [
    ["biome", ["biome.json", "biome.jsonc"]],
    [
      "prettier",
      [
        ".prettierrc",
        ".prettierrc.json",
        ".prettierrc.yml",
        ".prettierrc.yaml",
        ".prettierrc.json5",
        ".prettierrc.js",
        ".prettierrc.cjs",
        ".prettierrc.mjs",
        ".prettierrc.toml",
        "prettier.config.js",
        "prettier.config.cjs",
        "prettier.config.mjs",
        "prettier.config.ts",
      ],
    ],
    ["dprint", ["dprint.json", ".dprint.json", "dprint.jsonc"]],
  ],
  gitHooks: [
    ["husky", [".husky"]],
    ["lefthook", ["lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml"]],
    ["pre-commit", [".pre-commit-config.yaml", ".pre-commit-config.yml"]],
    ["simple-git-hooks", ["simple-git-hooks.json"]],
  ],
  linter: [
    ["biome", ["biome.json", "biome.jsonc"]],
    [
      "eslint",
      [
        ".eslintrc",
        ".eslintrc.js",
        ".eslintrc.cjs",
        ".eslintrc.json",
        ".eslintrc.yml",
        ".eslintrc.yaml",
        "eslint.config.js",
        "eslint.config.mjs",
        "eslint.config.cjs",
        "eslint.config.ts",
      ],
    ],
    [
      "oxlint",
      [
        ".oxlintrc",
        ".oxlintrc.json",
        ".oxlintrc.jsonc",
        "oxlint.config.ts",
        "oxlint.config.js",
        "oxlint.config.mjs",
      ],
    ],
  ],
  mutation: [
    [
      "stryker",
      [
        "stryker.conf.json",
        "stryker.conf.js",
        "stryker.conf.mjs",
        "stryker.conf.cjs",
        "stryker.config.json",
        "stryker.config.js",
        "stryker.config.mjs",
        ".strykerrc",
        ".strykerrc.json",
      ],
    ],
  ],
  testRunner: [
    [
      "vitest",
      [
        "vitest.config.ts",
        "vitest.config.js",
        "vitest.config.mts",
        "vitest.config.mjs",
        "vitest.workspace.ts",
        "vitest.workspace.js",
        "vitest.projects.ts",
      ],
    ],
    [
      "jest",
      [
        "jest.config.js",
        "jest.config.ts",
        "jest.config.cjs",
        "jest.config.mjs",
        "jest.config.json",
      ],
    ],
    ["bun-test", ["bunfig.toml"]],
  ],
  typechecker: [
    [
      "typescript",
      ["tsconfig.json", "tsconfig.base.json", "tsconfig.settings.json", "jsconfig.json"],
    ],
  ],
};

// Coverage has no config file of its own in the common setups: it is a key inside the test
// runner's config, or a dedicated rc file.
const COVERAGE_RC = [".nycrc", ".nycrc.json", ".nycrc.yml", ".nycrc.yaml", ".c8rc", ".c8rc.json"];
const COVERAGE_HOSTS = [
  "vitest.config.ts",
  "vitest.config.js",
  "vitest.config.mts",
  "vitest.config.mjs",
  "jest.config.js",
  "jest.config.ts",
  "jest.config.cjs",
  "jest.config.mjs",
  "jest.config.json",
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
          const inner = readdirSync(abs)
            .filter((n) => !n.startsWith("."))
            .sort();
          files.push(...(inner.length > 0 ? inner.map((n) => `${c}/${n}`) : [`${c}/`]));
        } else if (isFile(abs)) {
          files.push(c);
        }
      }
      if (files.length > 0) hits.push({ files, tool });
    }
    found[category] = hits;
  }

  const coverage = [];
  for (const c of COVERAGE_RC)
    if (isFile(join(dir, c)))
      coverage.push({ files: [c], tool: c.replace(/^\./, "").replace(/rc.*$/, "") });
  for (const c of COVERAGE_HOSTS) {
    const text = readText(join(dir, c));
    if (text !== null && /\bcoverage\b/.test(text))
      coverage.push({ files: [c], tool: c.split(".")[0] });
  }
  found.coverage = coverage;

  const gitHooksDir = join(dir, ".git", "hooks");
  if (isDir(gitHooksDir)) {
    const live = readdirSync(gitHooksDir)
      .filter((n) => !n.endsWith(".sample"))
      .sort();
    if (live.length > 0)
      found.gitHooks.push({ files: live.map((n) => `.git/hooks/${n}`), tool: "git-hooks-path" });
  }
  return found;
}

function readPackage(dir, relPath, role) {
  const manifest = readJson(join(dir, "package.json"));
  const deps = { ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) };
  return {
    dependencies: Object.keys(deps).sort(),
    hasManifest: manifest !== null,
    name: manifest?.name ?? null,
    path: relPath,
    role,
    scripts: Object.keys(manifest?.scripts ?? {}).sort(),
    tooling: detectTooling(dir),
    typescript: resolveTsconfig(dir),
  };
}

// ---------------------------------------------------------------------------
// 5. `when` evaluation
// ---------------------------------------------------------------------------

function predicateHolds(pred, ctx) {
  if (pred === null || typeof pred !== "object")
    return { detail: `unreadable predicate ${JSON.stringify(pred)}`, pass: false };
  if ("file" in pred) {
    const ok = existsSync(join(ctx.root, pred.file));
    return {
      detail: `${pred.file} ${ok ? "exists" : "is absent"} at the workspace root`,
      pass: ok,
    };
  }
  if ("dep" in pred) {
    const owners = ctx.packages.filter((p) => p.dependencies.includes(pred.dep)).map((p) => p.path);
    return {
      detail:
        owners.length > 0
          ? `${pred.dep} declared in ${owners.join(", ")}`
          : `${pred.dep} is not declared in any manifest`,
      pass: owners.length > 0,
    };
  }
  if ("script" in pred) {
    const ok = ctx.rootPackage.scripts.includes(pred.script);
    return {
      detail: `root package.json ${ok ? "has" : "has no"} script "${pred.script}"`,
      pass: ok,
    };
  }
  if ("testFile" in pred) {
    // The flow reader quotes bare tokens, so a flow `{ testFile: true }` arrives as the string
    // "true" while a block `- testFile: true` arrives as the boolean; both mean the same thing.
    // Any other value is not a predicate this contract defines.
    if (pred.testFile !== true && pred.testFile !== "true")
      return { detail: `unreadable predicate ${JSON.stringify(pred)}`, pass: false };
    const ok = hasTestFiles(ctx.root);
    return {
      detail: ok ? "the project has a test file" : "the project has no test file",
      pass: ok,
    };
  }
  if ("tsconfig" in pred) {
    // The flow reader quotes bare tokens, so a flow `{ tsconfig: strictNullChecks }` arrives as the
    // string "strictNullChecks". The option is read from the root chain, falling back to the
    // members that state one, and `strict: true` implies the strict-mode family.
    const option = pred.tsconfig;
    if (typeof option !== "string" || option === "")
      return { detail: `unreadable predicate ${JSON.stringify(pred)}`, pass: false };
    const rootTsconfig = ctx.packages[0]?.typescript ?? null;
    const { source, value } = aggregateOption(rootTsconfig, ctx.packages, option);
    return {
      detail:
        value === null
          ? `no tsconfig in the chain states ${option}`
          : `tsconfig ${option} is ${value}${source ? ` (${source})` : ""}`,
      pass: value === true,
    };
  }
  if ("recipe" in pred) {
    if (pred.recipe === "*") {
      const others = [...ctx.selection].filter((id) => id !== ctx.itemId && ctx.recipeIds.has(id));
      return {
        detail:
          others.length > 0
            ? `other recipes selected: ${others.join(", ")}`
            : "no other recipe is selected",
        pass: others.length > 0,
      };
    }
    const ok = ctx.recipeIds.has(pred.recipe) && ctx.selection.has(pred.recipe);
    return { detail: `recipe "${pred.recipe}" ${ok ? "is" : "is not"} selected`, pass: ok };
  }
  if ("practice" in pred) {
    if (pred.practice === "*") {
      const others = [...ctx.selection].filter(
        (id) => id !== ctx.itemId && ctx.practiceIds.has(id),
      );
      return {
        detail:
          others.length > 0
            ? `other practices selected: ${others.join(", ")}`
            : "no other practice is selected",
        pass: others.length > 0,
      };
    }
    const ok = ctx.practiceIds.has(pred.practice) && ctx.selection.has(pred.practice);
    return { detail: `practice "${pred.practice}" ${ok ? "is" : "is not"} selected`, pass: ok };
  }
  return { detail: `unknown predicate ${JSON.stringify(pred)}`, pass: false };
}

function evaluateWhen(item, ctx) {
  const when = item.when ?? {};
  const reasons = [];
  const push = (predicate, pass, detail) => reasons.push({ detail, pass, predicate });

  if (when.language) {
    const hit = when.language.filter((l) => ctx.languages[l]);
    push(
      "language",
      hit.length > 0,
      `needs one of [${when.language.join(", ")}]; detected ${hit.length > 0 ? hit.join(", ") : "none"}`,
    );
  }
  if (when.packageManager) {
    const hit = when.packageManager.includes(ctx.packageManager.name);
    push(
      "packageManager",
      hit,
      `needs one of [${when.packageManager.join(", ")}]; detected ${ctx.packageManager.name ?? "none"}`,
    );
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
    push(
      `excludes ${JSON.stringify(pred)}`,
      !pass,
      pass ? `excluded by ${detail}` : `not excluded (${detail})`,
    );
  }
  return { applicable: reasons.every((r) => r.pass), reasons };
}

// Selection is a fixpoint over recipes AND practices: `requires: [{ recipe: X }]` /
// `requires: [{ practice: X }]` makes applicability depend on the selection, and `conflicts.recipes`
// can remove a recipe another one requires. A practice's own `when` decides, evaluated by the same
// engine; `enforcedBy` is metadata and never selects. Grow, then shrink, until stable.
function selectItems(recipes, practices, ctx) {
  const usable = [...recipes, ...practices].filter((r) => r.error === null);
  const byId = new Map(usable.map((r) => [r.id, r]));
  const base = new Set();
  for (const r of usable) {
    const { applicable } = evaluateWhen(r, { ...ctx, itemId: r.id, selection: new Set() });
    if (applicable) base.add(r.id);
  }

  const selection = new Set(base);
  for (let guard = 0; guard < usable.length + 2; guard++) {
    let changed = false;
    for (const r of usable) {
      if (selection.has(r.id)) continue;
      const { applicable } = evaluateWhen(r, { ...ctx, itemId: r.id, selection });
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
        heldBack.push({
          id: loser.id,
          reason: `conflicts with "${winner.id}" (priority ${winner.priority ?? 0} > ${loser.priority ?? 0})`,
        });
        changed = true;
      }
    }
    for (const id of [...selection]) {
      const r = byId.get(id);
      const { applicable } = evaluateWhen(r, { ...ctx, itemId: r.id, selection });
      if (!applicable) {
        selection.delete(id);
        heldBack.push({ id, reason: "a dependency it requires is no longer selected" });
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { heldBack, selection };
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
          for (const h of hits)
            if (h.tool === tool) evidence.push(`${where} ${category}: ${h.files.join(", ")}`);
        }
      }
      if (evidence.length > 0) collisions.push({ evidence, recipe: r.id, tool });
    }
  }
  return collisions;
}

// ---------------------------------------------------------------------------
// 6. Report
// ---------------------------------------------------------------------------

function detect(projectDir, libraryDir) {
  const root = resolve(projectDir);
  if (!isDir(root)) throw new Error(`not a directory: ${root}`);
  const rootManifest = readJson(join(root, "package.json"));
  const packageManager = detectPackageManager(root, rootManifest);
  const workspace = detectWorkspace(root, rootManifest, packageManager.name);
  const rootTsconfig = resolveTsconfig(root);

  const rootPackage = readPackage(root, ".", "root");
  const packages = [rootPackage];
  for (const m of workspace.members)
    packages.push(readPackage(join(root, m.path), m.path, "member"));

  const languages = detectLanguages(root, rootManifest, rootTsconfig);
  const strictness = aggregateStrictness(rootTsconfig, packages);
  languages.typescriptStrict = languages.typescript ? strictness.value : null;
  languages.typescriptStrictSource = languages.typescript ? strictness.source : null;
  languages.tsconfig = rootTsconfig?.configFile ?? null;

  const remote = loadRecipes(libraryDir, { source: "library" });
  const local = loadRecipes(join(root, ".code-quality"), { optional: true, source: "local" });
  // Local wins on id collision. The merged list is sorted by the recipe's filename (`<id>.md`) —
  // the order the loader produced before the local layer existed — so the no-local case is
  // byte-identical to today. (Sorting by bare `id` would not be: `-` sorts before `.`, so
  // `biome-assist-npm.md` precedes `biome-assist.md`.)
  const localIds = new Set(local.map((r) => r.id));
  const recipes = [...local, ...remote.filter((r) => !localIds.has(r.id))].sort((a, b) =>
    `${a.id}.md` < `${b.id}.md` ? -1 : `${a.id}.md` > `${b.id}.md` ? 1 : 0,
  );

  // Practices load from the same two layers, with the same local-wins merge. The directory is
  // optional in both: a library or project with no practices is valid.
  const remotePractices = loadPractices(libraryDir, { layer: "library" });
  const localPractices = loadPractices(join(root, ".code-quality"), { layer: "local" });
  const localPracticeIds = new Set(localPractices.map((p) => p.id));
  const practices = [
    ...localPractices,
    ...remotePractices.filter((p) => !localPracticeIds.has(p.id)),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const ctx = {
    itemId: null,
    languages,
    packageManager,
    packages,
    // The universes of selectable ids, by kind: `{ recipe: … }` matches only a recipe and
    // `{ practice: … }` only a practice, so the two namespaces never bleed into each other.
    practiceIds: new Set(practices.filter((p) => p.error === null).map((p) => p.id)),
    recipeIds: new Set(recipes.filter((r) => r.error === null).map((r) => r.id)),
    root,
    rootPackage,
    selection: new Set(),
    workspace,
  };

  const { selection, heldBack } = selectItems(recipes, practices, ctx);
  const collisions = detectToolCollisions(recipes, selection, ctx);

  const matrix = recipes.map((r) => {
    if (r.error !== null) return { error: r.error, id: r.id, source: r.source };
    const { applicable, reasons } = evaluateWhen(r, { ...ctx, itemId: r.id, selection });
    return {
      applicable,
      commands: r.commands,
      conflicts: r.conflicts,
      cost: r.cost,
      error: null,
      files: r.files,
      gates: r.gates,
      id: r.id,
      libraryDir: r.libraryDir,
      priority: r.priority,
      purpose: r.purpose,
      reasons,
      selected: selection.has(r.id),
      source: r.source,
      title: r.title,
      undo: r.undo,
      verify: r.verify,
    };
  });

  const practiceMatrix = practices.map((p) => {
    if (p.error !== null) return { error: p.error, id: p.id, layer: p.layer };
    const { applicable, reasons } = evaluateWhen(p, { ...ctx, itemId: p.id, selection });
    return {
      applicable,
      enforcedBy: p.enforcedBy,
      error: null,
      id: p.id,
      layer: p.layer,
      libraryDir: p.libraryDir,
      reasons,
      selected: selection.has(p.id),
      source: p.source,
      title: p.title,
      when: p.when,
    };
  });

  const byId = new Map([...recipes, ...practices].map((r) => [r.id, r]));

  return {
    collisions,
    heldBack,
    packages,
    practices: practiceMatrix,
    recipes: matrix,
    root,
    schemaVersion: SCHEMA_VERSION,
    selection: [...selection].sort(
      (a, b) => (byId.get(b)?.priority ?? 0) - (byId.get(a)?.priority ?? 0),
    ),
    stack: { languages, packageManager, workspace },
  };
}

try {
  const args = process.argv.slice(2);
  const compact = args.includes("--compact");
  const libIdx = args.indexOf("--library");
  let libraryFlag = null;
  if (libIdx !== -1) {
    libraryFlag = args[libIdx + 1];
    if (libraryFlag === undefined) throw new Error("--library needs a path");
  }
  // Drop `--library` and its value so the value is never mistaken for the project dir.
  const rest = libIdx === -1 ? args : args.filter((_, i) => i !== libIdx && i !== libIdx + 1);
  const target = rest.find((a) => !a.startsWith("--")) ?? ".";
  const report = detect(target, resolveLibraryDir(libraryFlag));
  process.stdout.write(`${JSON.stringify(report, null, compact ? 0 : 2)}\n`);
} catch (err) {
  process.stderr.write(`detect.mjs: ${err.message}\n`);
  process.exit(1);
}
