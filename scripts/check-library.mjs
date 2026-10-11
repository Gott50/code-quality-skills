#!/usr/bin/env node
// check-library.mjs — validate the recipe library at the repo root.
//
// Three independent checks; the script exits non-zero if any fails:
//
//   1. index freshness — regenerate library/library.json exactly as
//      scripts/build-library.mjs does and compare bytes. The generator is
//      duplicated here on purpose: importing it would run its top-level
//      writeFileSync and silently repair a stale index instead of failing.
//   2. recipe contract — every library/recipes/*.md parses and satisfies
//      RECIPE-CONTRACT.md: `id` equals the filename stem and is kebab-case;
//      every files[].template exists under library/; every gates[].floor is
//      one of the six known gates.
//   3. template formatting — every biome-parseable template under
//      library/templates/** is `biome format`-clean after the {{root}} /
//      {{plan.*}} placeholders are substituted with dummy values. Files biome
//      cannot parse (by extension, or a parse error) are skipped and printed.
//
// Zero dependencies beyond the shared frontmatter reader and the repo's own
// biome devDependency. Usage: node scripts/check-library.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../skills/code-quality-setup/scripts/frontmatter.mjs";

const SCHEMA_VERSION = 1;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY_DIR = join(REPO_ROOT, "library");
const RECIPES_DIR = join(LIBRARY_DIR, "recipes");
const TEMPLATES_DIR = join(LIBRARY_DIR, "templates");
const INDEX = join(LIBRARY_DIR, "library.json");
const BIOME_CONFIG = join(REPO_ROOT, "biome.json");

// The six gates a `floor` may name (RECIPE-CONTRACT.md → `floor`).
const FLOORS = new Set(["coverage", "mutation", "lint", "typecheck", "fallow-health", "fallow-dead-code"]);

// Extensions biome parses and formats. Everything else is skipped and printed.
const PARSEABLE = new Set([".json", ".jsonc", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"]);

// The placeholders the apply pipeline substitutes (plan.mjs → substitute()).
// Only these are replaced: the oxlint rule templates legitimately carry
// `{{name}}`/`{{target}}` inside message strings and must stay untouched.
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

// --- 1. index freshness -----------------------------------------------------

// A byte-for-byte copy of scripts/build-library.mjs's build().
function buildIndex() {
  const files = readdirSync(RECIPES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const recipes = files.map((file) => {
    const stem = basename(file, ".md");
    const label = `library/recipes/${file}`;
    let fm;
    try {
      fm = parseFrontmatter(readFileSync(join(RECIPES_DIR, file), "utf8"), label);
    } catch (err) {
      throw new Error(`${label}: ${err.message}`);
    }
    if (fm.id !== stem) throw new Error(`${label}: id "${fm.id}" must equal the filename stem`);
    if (!/^[a-z][a-z0-9-]*$/.test(fm.id)) throw new Error(`${label}: id "${fm.id}" is not kebab-case`);
    return {
      id: fm.id,
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
    };
  });
  recipes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { schemaVersion: SCHEMA_VERSION, recipes };
}

function checkIndex() {
  let doc;
  try {
    doc = buildIndex();
  } catch (err) {
    fail(`index: cannot regenerate — ${err.message}`);
    return;
  }
  const expected = `${JSON.stringify(doc, null, 2)}\n`;
  const actual = readFileSync(INDEX, "utf8");
  if (actual !== expected) {
    fail("index: library/library.json is stale — run `node scripts/build-library.mjs`");
  }
}

// --- 2. recipe contract -----------------------------------------------------

function checkRecipes() {
  const files = readdirSync(RECIPES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  for (const file of files) {
    const stem = basename(file, ".md");
    const label = `library/recipes/${file}`;
    let fm;
    try {
      fm = parseFrontmatter(readFileSync(join(RECIPES_DIR, file), "utf8"), label);
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
      if (!existsSync(join(LIBRARY_DIR, f.template))) {
        fail(`${label}: template "${f.template}" does not exist under library/`);
      }
    }
    for (const g of fm.gates ?? []) {
      if (g.floor !== undefined && !FLOORS.has(g.floor)) {
        fail(`${label}: gate "${g.id}" has floor "${g.floor}" — not one of ${[...FLOORS].join(", ")}`);
      }
    }
  }
  return files.length;
}

// --- 3. template formatting -------------------------------------------------

function substitute(text) {
  let out = text;
  for (const [key, value] of SUBSTITUTIONS) out = out.replaceAll(key, value);
  return out;
}

function resolveBiome() {
  const local = join(REPO_ROOT, "node_modules", ".bin", "biome");
  if (existsSync(local)) return { cmd: local, args: [] };
  return { cmd: "bunx", args: ["@biomejs/biome"] };
}

function checkTemplates() {
  const files = walk(TEMPLATES_DIR);
  const parseable = [];
  const skipped = [];
  for (const abs of files) {
    const rel = relative(TEMPLATES_DIR, abs);
    const ext = extname(abs).toLowerCase();
    if (!PARSEABLE.has(ext)) {
      skipped.push([rel, `not a biome-parsed type (${ext || "no extension"})`]);
      continue;
    }
    parseable.push([abs, rel]);
  }

  const tmp = mkdtempSync(join(tmpdir(), "check-library-"));
  try {
    for (const [abs, rel] of parseable) {
      const dest = join(tmp, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, substitute(readFileSync(abs, "utf8")));
    }

    const { cmd, args } = resolveBiome();
    let stdout = "";
    try {
      stdout = execFileSync(cmd, [...args, "format", `--config-path=${BIOME_CONFIG}`, "--reporter=json", "."], {
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
    rmSync(tmp, { recursive: true, force: true });
  }

  for (const [rel, why] of skipped) process.stdout.write(`skip templates/${rel} — ${why}\n`);
  return { checked: parseable.length, skipped };
}

// --- run --------------------------------------------------------------------

checkIndex();
const recipeCount = checkRecipes();
const { checked, skipped } = checkTemplates();

if (errors.length > 0) {
  process.stderr.write(`check-library: FAILED (${errors.length})\n`);
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}

process.stdout.write(
  `check-library: ok — index fresh, ${recipeCount} recipes valid, ${checked} templates formatted (${skipped.length} skipped)\n`,
);
