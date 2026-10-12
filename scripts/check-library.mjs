#!/usr/bin/env node
// check-library.mjs — validate the recipe library at the repo root.
//
// Five independent checks; the script exits non-zero if any fails:
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
//   4. template lint — every template is laid out as a consumer would see it
//      (the oxlint config at the root, its plugin under tools/, the rest at
//      their recipe-relative paths) and linted against that config, so the
//      scripts the recipes install satisfy the rules the same selection
//      installs. Templates oxlint does not lint (by extension) are skipped and
//      printed.
//   5. skill script formatting — the skill's own shipped scripts under
//      skills/*/scripts/ are `biome check`-clean under the repo's biome.json,
//      the same config the skill installs. A consumer's `biome check .` runs
//      over the files the skill just copied in, so a script that is not
//      formatted to the convention fails there; the repo's own format:check
//      covers only library/templates, so this is the only place that holds
//      them. Files biome cannot parse (by extension) are skipped and printed.
//
// Zero dependencies beyond the shared frontmatter reader and the repo's own
// biome devDependency; the lint check installs the oxlint devDependencies the
// oxlint-anti-slop recipe pins into a scratch dir. Usage: node scripts/check-library.mjs

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
import { parseFrontmatter } from "../skills/code-quality-setup/scripts/frontmatter.mjs";

const SCHEMA_VERSION = 1;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY_DIR = join(REPO_ROOT, "library");
const RECIPES_DIR = join(LIBRARY_DIR, "recipes");
const TEMPLATES_DIR = join(LIBRARY_DIR, "templates");
const INDEX = join(LIBRARY_DIR, "library.json");
const BIOME_CONFIG = join(REPO_ROOT, "biome.json");

// The skill's own shipped scripts. The skills CLI copies each skill directory
// into a consumer's .agents/skills/<name>/, so these files land in the consumer
// repo and are covered by its `biome check .`.
const SKILLS_DIR = join(REPO_ROOT, "skills");
const SKILL_SCRIPT_DIRS = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(SKILLS_DIR, entry.name, "scripts"))
  .filter((dir) => existsSync(dir));

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

// Extensions oxlint lints. Everything else is skipped and printed.
const LINTABLE = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"]);

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
    if (!/^[a-z][a-z0-9-]*$/.test(fm.id))
      throw new Error(`${label}: id "${fm.id}" is not kebab-case`);
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
        fail(
          `${label}: gate "${g.id}" has floor "${g.floor}" — not one of ${[...FLOORS].join(", ")}`,
        );
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
      stdout = execFileSync(
        cmd,
        [...args, "format", `--config-path=${BIOME_CONFIG}`, "--reporter=json", "."],
        {
          cwd: tmp,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
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

// --- 4. template lint -------------------------------------------------------

// The oxlint config the oxlint-anti-slop recipe installs, and the plugin it
// registers. The templates are linted against it in a scratch consumer layout:
// the config at the root, the plugin under tools/oxlint/anti-slop/ (which the
// config's ignorePatterns excludes), and every other template at its
// recipe-relative path. oxlint resolves no imports, so the paths need only
// keep the config's own relative specifier and ignore patterns valid.
const OXLINT_DIR = join(TEMPLATES_DIR, "oxlint-anti-slop");
const OXLINT_CONFIG_REL = join("oxlint-anti-slop", "oxlint.config.ts");
const OXLINT_TOOLS_REL = join("oxlint-anti-slop", "tools");

// The oxlint devDependencies the recipe's package.json fragment pins.
function oxlintDeps() {
  const pkg = JSON.parse(readFileSync(join(OXLINT_DIR, "package.json"), "utf8"));
  return pkg.devDependencies ?? {};
}

// Install the recipe's oxlint devDependencies into the scratch dir and return
// the oxlint binary. The repo does not depend on oxlint itself, so the check
// carries its own install; bun's global cache makes a repeat run cheap.
function installOxlint(tmp) {
  writeFileSync(
    join(tmp, "package.json"),
    `${JSON.stringify(
      { name: "check-library-lint", private: true, type: "module", devDependencies: oxlintDeps() },
      null,
      2,
    )}\n`,
  );
  execFileSync("bun", ["install", "--silent"], { cwd: tmp, stdio: ["ignore", "pipe", "pipe"] });
  return join(tmp, "node_modules", ".bin", "oxlint");
}

function checkTemplateLint() {
  const skipped = [];
  const tmp = mkdtempSync(join(tmpdir(), "check-library-lint-"));
  let checked = 0;
  try {
    for (const abs of walk(TEMPLATES_DIR)) {
      const rel = relative(TEMPLATES_DIR, abs);
      const ext = extname(abs).toLowerCase();
      if (!LINTABLE.has(ext)) {
        skipped.push([rel, `not a linted type (${ext || "no extension"})`]);
        continue;
      }
      // The config lands at the root, its plugin under tools/; everything else
      // keeps its recipe-relative path.
      let dest;
      if (rel === OXLINT_CONFIG_REL) dest = join(tmp, "oxlint.config.ts");
      else if (rel.startsWith(OXLINT_TOOLS_REL))
        dest = join(tmp, rel.slice("oxlint-anti-slop/".length));
      else dest = join(tmp, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, substitute(readFileSync(abs, "utf8")));
    }
    for (const [rel, why] of skipped) process.stdout.write(`skip templates/${rel} — ${why}\n`);

    let oxlint;
    try {
      oxlint = installOxlint(tmp);
    } catch (err) {
      fail(`lint: could not install oxlint — ${err.message}`);
      return { checked, skipped };
    }

    let stdout = "";
    try {
      stdout = execFileSync(oxlint, ["--format", "json", "."], {
        cwd: tmp,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      // oxlint exits non-zero when it reports diagnostics; its JSON is still on
      // stdout. Only a run that produced no output at all is a failure to run.
      stdout = err.stdout ?? "";
      if (!stdout) {
        fail(`lint: oxlint failed to run — ${err.message}`);
        return { checked, skipped };
      }
    }

    let report;
    try {
      report = JSON.parse(stdout);
    } catch {
      fail("lint: could not parse oxlint's JSON output");
      return { checked, skipped };
    }

    for (const d of report.diagnostics ?? []) {
      fail(`templates/${d.filename}: ${d.code} ${d.message}`);
    }
    checked = report.number_of_files ?? 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { checked, skipped };
}

// --- 5. skill script formatting ---------------------------------------------

// The skill's own scripts must satisfy the same biome config the skill installs
// (2-space, lineWidth 100, double quotes, semicolons, assist on), or a
// consumer's `biome check .` fails on the files the skill just copied in. Run
// biome's `check` (format + assist + lint) over the scripts and fail on any
// error-severity diagnostic; warnings and infos are not errors. Files biome
// cannot parse (by extension) are skipped and printed.
function checkSkillScripts() {
  const parseable = [];
  const skipped = [];
  for (const dir of SKILL_SCRIPT_DIRS) {
    for (const abs of walk(dir)) {
      const rel = relative(REPO_ROOT, abs);
      const ext = extname(abs).toLowerCase();
      if (!PARSEABLE.has(ext)) {
        skipped.push([rel, `not a biome-parsed type (${ext || "no extension"})`]);
        continue;
      }
      parseable.push(rel);
    }
  }

  const { cmd, args } = resolveBiome();
  let stdout = "";
  try {
    stdout = execFileSync(
      cmd,
      [...args, "check", `--config-path=${BIOME_CONFIG}`, "--reporter=json", ...SKILL_SCRIPT_DIRS],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    // biome exits non-zero when it reports diagnostics; its JSON is still on
    // stdout. Only a run that produced no output at all is a failure to run.
    stdout = err.stdout ?? "";
    if (!stdout) {
      fail(`skill scripts: biome failed to run — ${err.message}`);
      return { checked: parseable.length, skipped };
    }
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    fail("skill scripts: could not parse biome's JSON output");
    return { checked: parseable.length, skipped };
  }

  for (const d of report.diagnostics ?? []) {
    if (d.severity !== "error") continue;
    const rel = d.location?.path ?? "(unknown)";
    if (d.category === "format") {
      fail(`${rel}: not formatted — run \`biome check --write\``);
      continue;
    }
    fail(`${rel}: biome reported ${d.category}: ${d.message}`);
  }

  for (const [rel, why] of skipped) process.stdout.write(`skip ${rel} — ${why}\n`);
  return { checked: parseable.length, skipped };
}

// --- run --------------------------------------------------------------------

checkIndex();
const recipeCount = checkRecipes();
const { checked, skipped } = checkTemplates();
const lint = checkTemplateLint();
const scripts = checkSkillScripts();

if (errors.length > 0) {
  process.stderr.write(`check-library: FAILED (${errors.length})\n`);
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}

process.stdout.write(
  `check-library: ok — index fresh, ${recipeCount} recipes valid, ${checked} templates formatted (${skipped.length} skipped), ${lint.checked} templates linted, ${scripts.checked} skill scripts formatted (${scripts.skipped.length} skipped)\n`,
);
