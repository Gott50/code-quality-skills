#!/usr/bin/env node
// build-library.mjs — emit library/library.json from the recipe frontmatter.
//
// Zero dependencies, node builtins only. Reads every library/recipes/*.md frontmatter with the
// shared strict-subset reader (skills/code-quality-setup/scripts/frontmatter.mjs, the same copy
// detect.mjs uses) and writes the machine-readable library index: one entry per recipe, sorted by
// id, canonical JSON (two-space indent, trailing newline) so a re-run is byte-identical.
//
// Usage: node scripts/build-library.mjs
//
// The frontmatter contract is library/RECIPE-CONTRACT.md. A malformed recipe fails the build with
// a clear message; it is never silently skipped. The content hash is computed by the fetch, not
// stored here (ticket #112); library.json carries only the integer schemaVersion.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../skills/code-quality-setup/scripts/frontmatter.mjs";

const SCHEMA_VERSION = 1;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY_DIR = join(REPO_ROOT, "library");
const RECIPES_DIR = join(LIBRARY_DIR, "recipes");
const OUT = join(LIBRARY_DIR, "library.json");

function build() {
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

try {
  const doc = build();
  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  process.stdout.write(`wrote ${OUT} (${doc.recipes.length} recipes)\n`);
} catch (err) {
  process.stderr.write(`build-library: ${err.message}\n`);
  process.exit(1);
}
