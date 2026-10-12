#!/usr/bin/env node
// check-local.mjs — validate a project's local recipe layer (.code-quality/).
//
// The local layer mirrors the library: `.code-quality/recipes/<id>.md` plus
// `.code-quality/templates/<id>/…`. This script is the cheap contract check the authoring skill
// runs before applying a local recipe, mirroring `scripts/check-library.mjs`:
//
//   1. recipe contract — every `.code-quality/recipes/*.md` parses and satisfies
//      RECIPE-CONTRACT.md: `id` equals the filename stem and is kebab-case; every
//      files[].template exists under `.code-quality/`; every gates[].floor is one of the six
//      known gates.
//   2. template formatting — every biome-parseable template under `.code-quality/templates/**` is
//      `biome format`-clean after the {{root}} / {{plan.*}} placeholders are substituted with dummy
//      values. Files biome cannot parse (by extension, or a parse error) are skipped and printed.
//      When the project carries no biome (no `node_modules/.bin/biome` and no `bunx`), the check is
//      skipped, not failed.
//
// Zero dependencies beyond the shared frontmatter reader. Usage:
// node scripts/check-local.mjs [projectDir] [--json]

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { parseFrontmatter } from "../../code-quality-setup/scripts/frontmatter.mjs";

const SCHEMA_VERSION = 1;

// The six gates a `floor` may name (RECIPE-CONTRACT.md → `floor`).
const FLOORS = new Set([
  "coverage",
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
  if (existsSync(local)) return { cmd: local, args: [] };
  if (commandExists("bunx")) return { cmd: "bunx", args: ["@biomejs/biome"] };
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
  return files.length;
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
  try {
    for (const [abs, rel] of parseable) {
      const dest = join(tmp, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, substitute(readFileSync(abs, "utf8")));
    }

    const configPath = join(projectDir, "biome.json");
    const configArgs = existsSync(configPath) ? [`--config-path=${configPath}`] : [];
    const formatArgs = [...biome.args, "format", ...configArgs, "--reporter=json", "."];
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
    rmSync(tmp, { recursive: true, force: true });
  }

  printSkipped();
  return { checked: parseable.length, skipped };
}

// --- run --------------------------------------------------------------------

try {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--")) ?? ".";
  const root = resolve(target);
  const localDir = join(root, ".code-quality");
  const recipesDir = join(localDir, "recipes");

  if (!existsSync(recipesDir)) {
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, root, localDir, recipes: 0, templates: 0, errors: [] }, null, 2)}\n`,
      );
    } else {
      process.stdout.write("no local recipes\n");
    }
    process.exit(0);
  }

  const recipeCount = checkRecipes(recipesDir, localDir);
  const { checked, skipped } = checkTemplates(join(localDir, "templates"), root);

  if (errors.length > 0) {
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, root, localDir, recipes: recipeCount, templates: checked, errors }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(`check-local: FAILED (${errors.length})\n`);
      for (const e of errors) process.stderr.write(`  - ${e}\n`);
    }
    process.exit(1);
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, root, localDir, recipes: recipeCount, templates: checked, errors: [] }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(
      `check-local: ok — ${recipeCount} recipes valid, ${checked} templates formatted (${skipped.length} skipped)\n`,
    );
  }
} catch (err) {
  process.stderr.write(`check-local.mjs: ${err.message}\n`);
  process.exit(1);
}
