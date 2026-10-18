#!/usr/bin/env node
// check-local.mjs — validate a project's local layer (.code-quality/).
//
// The local layer mirrors the library: `.code-quality/recipes/<id>.md` plus
// `.code-quality/templates/<id>/…`, and `.code-quality/practices/<id>.md`. This script is the cheap
// contract check the authoring skill runs before applying a local recipe or practice, mirroring
// `scripts/check-library.mjs`:
//
//   1. recipe contract — every `.code-quality/recipes/*.md` parses and satisfies
//      RECIPE-CONTRACT.md: `id` equals the filename stem and is kebab-case; every
//      files[].template exists under `.code-quality/`; every gates[].floor is one of the seven
//      known gates.
//   2. template formatting — every biome-parseable template under `.code-quality/templates/**` is
//      `biome format`-clean after the {{root}} / {{plan.*}} placeholders are substituted with dummy
//      values. Files biome cannot parse (by extension, or a parse error) are skipped and printed.
//      The project's own `biome.json` is used when it exists; otherwise the library's own
//      convention (2-space, 100 columns) is used, never biome's defaults. When the project carries
//      no biome (no `node_modules/.bin/biome` and no `bunx`), the check is skipped, not failed.
//   3. practice contract — every `.code-quality/practices/*.md` parses and satisfies
//      RECIPE-CONTRACT.md → Practices: `id` equals the filename stem and is kebab-case and does not
//      collide with a recipe id; `source` resolves under the project root;
//      every `enforcedBy` id names a recipe in the merged layer (local plus library); `when`
//      parses. A practice has no gate, so there is no floor or template rule to check.
//
// Zero dependencies beyond the shared frontmatter reader. Usage:
// node scripts/check-local.mjs [projectDir] [--library <path>] [--json]

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../../code-quality-setup/scripts/frontmatter.mjs";

const SCHEMA_VERSION = 1;

// The library the local layer is validated against: `--library <path>`, else $CODE_QUALITY_LIBRARY,
// else the repo-layout default (`library/` two levels up from the skill dir). The same precedence
// `gaps.mjs` uses, so the authoring flow passes one path to both. A library with no `recipes/`
// contributes no recipe ids, so a project with no library still validates its own recipes.
const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LIBRARY_DIR = resolve(SKILL_DIR, "..", "..", "library");

function resolveLibraryDir(flag) {
  return resolve(flag ?? process.env.CODE_QUALITY_LIBRARY ?? DEFAULT_LIBRARY_DIR);
}

// The recipe ids the library contributes to the merged layer a practice's `enforcedBy` resolves
// against. The local recipes are added by the caller.
function libraryRecipeIds(libraryDir) {
  const dir = join(libraryDir, "recipes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => basename(f, ".md"));
}

// The seven gates a `floor` may name (RECIPE-CONTRACT.md → `floor`). The same set
// the library layer's check uses, so a local recipe is not rejected for a floor the
// library accepts.
const FLOORS = new Set([
  "coverage",
  "dep-audit",
  "mutation",
  "lint",
  "typecheck",
  "fallow-health",
  "fallow-dead-code",
]);

// Extensions biome parses and formats. Everything else is skipped and printed.
const PARSEABLE = new Set([
  ".json",
  ".jsonc",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".jsx",
  ".tsx",
]);

// The library's own formatter convention (the repo's biome.json): 2-space indentation, 100-column
// lines. Used when the project carries no biome config of its own. Biome's defaults (tabs, 80
// columns) would reject the library's own templates and flip the verdict once the recipe's sweep
// installs a 2-space biome.json.
const LIBRARY_FORMATTER = {
  formatter: { enabled: true, indentStyle: "space", indentWidth: 2, lineWidth: 100 },
  javascript: { formatter: { quoteStyle: "double", semicolons: "always" } },
};

// The placeholders the apply pipeline substitutes (plan.mjs → substitute()). Only these are
// replaced: the oxlint rule templates legitimately carry `{{name}}`/`{{target}}` inside message
// strings and must stay untouched.
const SUBSTITUTIONS = [
  ["{{root}}", "."],
  ["{{plan.areas}}", '[["", "stryker.conf.mjs"]]'],
  ["{{plan.gates}}", "_No gates wired._"],
  ["{{plan.details}}", "_No details._"],
];

const errors = [];
const fail = (msg) => errors.push(msg);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

function substitute(text) {
  let out = text;
  for (const [key, value] of SUBSTITUTIONS) out = out.replaceAll(key, value);
  return out;
}

// `bunx` is the fallback formatter when the project has no local biome. A missing binary is a
// skip, not a failure: the local layer is still valid without a formatter to check it against.
function commandExists(name) {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir && existsSync(join(dir, name))) return true;
  }
  return false;
}

function resolveBiome(projectDir) {
  const local = join(projectDir, "node_modules", ".bin", "biome");
  if (existsSync(local)) return { args: [], cmd: local };
  if (commandExists("bunx")) return { args: ["@biomejs/biome"], cmd: "bunx" };
  return null;
}

// --- 1. recipe contract -----------------------------------------------------

function checkRecipes(recipesDir, localDir) {
  const files = readdirSync(recipesDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  for (const file of files) {
    const stem = basename(file, ".md");
    const label = `.code-quality/recipes/${file}`;
    let fm;
    try {
      fm = parseFrontmatter(readFileSync(join(recipesDir, file), "utf8"), label);
    } catch (err) {
      fail(`${label}: ${err.message}`);
      continue;
    }
    if (fm.id !== stem) fail(`${label}: id "${fm.id}" must equal the filename stem "${stem}"`);
    if (typeof fm.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(fm.id)) {
      fail(`${label}: id "${fm.id}" is not kebab-case`);
    }
    for (const f of fm.files ?? []) {
      if (!f.template) {
        fail(`${label}: files[] entry for "${f.path}" names no template`);
        continue;
      }
      if (!existsSync(join(localDir, f.template))) {
        fail(`${label}: template "${f.template}" does not exist under .code-quality/`);
      }
    }
    for (const g of fm.gates ?? []) {
      if (g.floor !== undefined && !FLOORS.has(g.floor)) {
        fail(
          `${label}: gate "${g.id}" has floor "${g.floor}" — not one of ${[...FLOORS].join(", ")}`,
        );
      }
    }
  }
  return files.map((f) => basename(f, ".md"));
}

// --- 2. template formatting -------------------------------------------------

function checkTemplates(templatesDir, projectDir) {
  if (!existsSync(templatesDir)) return { checked: 0, skipped: [] };
  const files = walk(templatesDir);
  const parseable = [];
  const skipped = [];
  for (const abs of files) {
    const rel = relative(templatesDir, abs);
    const ext = extname(abs).toLowerCase();
    if (!PARSEABLE.has(ext)) {
      skipped.push([rel, `not a biome-parsed type (${ext || "no extension"})`]);
      continue;
    }
    parseable.push([abs, rel]);
  }

  const printSkipped = () => {
    for (const [rel, why] of skipped) process.stdout.write(`skip templates/${rel} — ${why}\n`);
  };

  if (parseable.length === 0) {
    printSkipped();
    return { checked: 0, skipped };
  }

  const biome = resolveBiome(projectDir);
  if (biome === null) {
    printSkipped();
    process.stdout.write("skip templates — no biome in the project\n");
    return { checked: 0, skipped };
  }

  const tmp = mkdtempSync(join(tmpdir(), "check-local-"));
  let configTmp = null;
  try {
    for (const [abs, rel] of parseable) {
      const dest = join(tmp, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, substitute(readFileSync(abs, "utf8")));
    }

    // The project's own biome config when it has one; otherwise the library's own convention,
    // never biome's defaults. The fallback config is written outside the scanned tree so biome
    // does not format it as a template, and passing it as `--config-path` also keeps a template
    // named `biome.json` from being read as a nested root configuration.
    const projectConfig = join(projectDir, "biome.json");
    let configPath = projectConfig;
    if (!existsSync(projectConfig)) {
      configTmp = mkdtempSync(join(tmpdir(), "check-local-config-"));
      configPath = join(configTmp, "biome.json");
      writeFileSync(configPath, `${JSON.stringify(LIBRARY_FORMATTER, null, 2)}\n`);
    }
    const formatArgs = [
      ...biome.args,
      "format",
      `--config-path=${configPath}`,
      "--reporter=json",
      ".",
    ];
    let stdout = "";
    try {
      stdout = execFileSync(biome.cmd, formatArgs, {
        cwd: tmp,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      stdout = err.stdout ?? "";
      if (!stdout) {
        fail(`templates: biome failed to run — ${err.message}`);
        return { checked: parseable.length, skipped };
      }
    }

    let report;
    try {
      report = JSON.parse(stdout);
    } catch {
      fail("templates: could not parse biome's JSON output");
      return { checked: parseable.length, skipped };
    }

    for (const d of report.diagnostics ?? []) {
      const rel = d.location?.path ?? "(unknown)";
      if (d.category === "parse") {
        skipped.push([rel, "biome could not parse it"]);
        continue;
      }
      if (d.category === "format") {
        fail(`templates/${rel}: not formatted — run \`biome format --write\``);
        continue;
      }
      fail(`templates/${rel}: biome reported ${d.category}: ${d.message}`);
    }
  } finally {
    rmSync(tmp, { force: true, recursive: true });
    if (configTmp !== null) rmSync(configTmp, { force: true, recursive: true });
  }

  printSkipped();
  return { checked: parseable.length, skipped };
}

// --- 3. practice contract ---------------------------------------------------

// A practice's `when` is the recipe predicate language, so it must parse to a map whose known keys
// have the right shape. The frontmatter reader already parsed the block; this rejects a `when` that
// is a scalar, an array, or a map with a malformed predicate list. Mirrors `check-library.mjs`.
function checkWhen(when, label) {
  if (when === null || typeof when !== "object" || Array.isArray(when)) {
    fail(`${label}: when must be a map`);
    return;
  }
  for (const key of ["language", "packageManager"]) {
    if (when[key] !== undefined && !Array.isArray(when[key])) {
      fail(`${label}: when.${key} must be a list`);
    }
  }
  if (when.workspace !== undefined && typeof when.workspace !== "string") {
    fail(`${label}: when.workspace must be a string`);
  }
  for (const key of ["requires", "excludes"]) {
    if (when[key] === undefined) continue;
    if (!Array.isArray(when[key])) {
      fail(`${label}: when.${key} must be a list of predicates`);
      continue;
    }
    for (const pred of when[key]) {
      if (pred === null || typeof pred !== "object" || Array.isArray(pred)) {
        fail(`${label}: when.${key} entry ${JSON.stringify(pred)} is not a predicate`);
      }
    }
  }
}

// A practice is reference prose for the half of a best practice no gate can fail on, so its
// contract is the frontmatter alone — no template, no floor. `source` is the research note it is
// drawn from, a project-relative path (the local layer's root is the project, exactly as the
// library's is the library repo). `enforcedBy` names recipes in the merged layer — the local
// recipes plus the library's.
function checkPractices(practicesDir, projectRoot, recipeIds) {
  const files = readdirSync(practicesDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  for (const file of files) {
    const stem = basename(file, ".md");
    const label = `.code-quality/practices/${file}`;
    let fm;
    try {
      fm = parseFrontmatter(readFileSync(join(practicesDir, file), "utf8"), label);
    } catch (err) {
      fail(`${label}: ${err.message}`);
      continue;
    }
    if (fm.id !== stem) fail(`${label}: id "${fm.id}" must equal the filename stem "${stem}"`);
    if (typeof fm.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(fm.id)) {
      fail(`${label}: id "${fm.id}" is not kebab-case`);
    }
    if (recipeIds.has(fm.id)) fail(`${label}: id "${fm.id}" collides with a recipe id`);
    if (typeof fm.source !== "string" || fm.source === "") {
      fail(`${label}: source must be a project-relative path to the research note`);
    } else if (!existsSync(join(projectRoot, fm.source))) {
      fail(`${label}: source "${fm.source}" does not exist under the project root`);
    }
    if (fm.enforcedBy !== undefined && !Array.isArray(fm.enforcedBy)) {
      fail(`${label}: enforcedBy must be a list of recipe ids`);
    } else {
      for (const id of fm.enforcedBy ?? []) {
        if (!recipeIds.has(id)) fail(`${label}: enforcedBy "${id}" names no recipe`);
      }
    }
    checkWhen(fm.when ?? {}, label);
  }
  return files.length;
}

// --- run --------------------------------------------------------------------

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
  const root = resolve(target);
  const libraryDir = resolveLibraryDir(libraryFlag);
  const localDir = join(root, ".code-quality");
  const recipesDir = join(localDir, "recipes");
  const practicesDir = join(localDir, "practices");
  const hasRecipes = existsSync(recipesDir);
  const hasPractices = existsSync(practicesDir);

  if (!hasRecipes && !hasPractices) {
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ errors: [], localDir, practices: 0, recipes: 0, root, schemaVersion: SCHEMA_VERSION, templates: 0 }, null, 2)}\n`,
      );
    } else {
      process.stdout.write("no local layer\n");
    }
    process.exit(0);
  }

  const localRecipeIds = hasRecipes ? checkRecipes(recipesDir, localDir) : [];
  // A practice's `enforcedBy` resolves against the merged layer the detector sees: local plus
  // library. The library contributes ids only; its own files are validated by check-library.mjs.
  const recipeIds = new Set(localRecipeIds);
  for (const id of libraryRecipeIds(libraryDir)) recipeIds.add(id);
  const practiceCount = hasPractices ? checkPractices(practicesDir, root, recipeIds) : 0;
  const { checked, skipped } = checkTemplates(join(localDir, "templates"), root);
  const recipeCount = localRecipeIds.length;

  if (errors.length > 0) {
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ errors, localDir, practices: practiceCount, recipes: recipeCount, root, schemaVersion: SCHEMA_VERSION, templates: checked }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(`check-local: FAILED (${errors.length})\n`);
      for (const e of errors) process.stderr.write(`  - ${e}\n`);
    }
    process.exit(1);
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ errors: [], localDir, practices: practiceCount, recipes: recipeCount, root, schemaVersion: SCHEMA_VERSION, templates: checked }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(
      `check-local: ok — ${recipeCount} recipes valid, ${practiceCount} practices valid, ${checked} templates formatted (${skipped.length} skipped)\n`,
    );
  }
} catch (err) {
  process.stderr.write(`check-local.mjs: ${err.message}\n`);
  process.exit(1);
}
