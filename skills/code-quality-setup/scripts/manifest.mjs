#!/usr/bin/env node
// manifest.mjs — the canonical writer for the applied-state manifest (.code-quality.json).
//
// Zero dependencies, node builtins only. The agent invokes it to record each recipe (and each
// decline) instead of hand-writing JSON. The manifest is a committed file (ADR 0002), so it must be
// in the one form the formatter recipes' `biome check .` leaves alone: keys sorted, two spaces of
// indent, a trailing newline. Hand-written JSON is not byte-stable — Biome's `useSortedKeys` also
// checks indentation and the trailing newline (#34) — so the serialization lives here, in one
// place, and the agent never writes the file by hand.
//
// Usage:
//   node scripts/manifest.mjs record [projectDir] --recipe <id> --recipe-hash <hash> \
//     [--file <path>:<action>:<hash>]... [--skill-version <v>] [--environment <json>] [--applied-at <iso>]
//   node scripts/manifest.mjs decline [projectDir] --recipe <id> [--applied-at <iso>]
//   node scripts/manifest.mjs canonicalize [projectDir]
//
// The schema is unchanged (schemaVersion 1, recipes[], declined[]; PLAN-SCHEMA.md → the manifest
// hash convention). This file owns only the serialization. `record` and `decline` are idempotent:
// re-recording a recipe whose content is unchanged rewrites the same bytes, so the manifest is
// byte-stable across runs.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MANIFEST_NAME = ".code-quality.json";
const SCHEMA_VERSION = 1;
const LINE_WIDTH = 100;
const SKILL_NAME = "code-quality-setup";
const ACTIONS = ["create", "merge", "patch"];

// ---------------------------------------------------------------------------
// Canonical serialization — the form `biome check .` leaves alone
// ---------------------------------------------------------------------------

// Biome's `useSortedKeys` comparator: case-insensitive, digit runs compare numerically, and on a
// full tie the uppercase spelling sorts first. The manifest's keys are all lowercase-first
// camelCase with no digits, so this is a plain sort for them; the comparator is here so a future
// key cannot silently break the formatter-stable guarantee.
function tokenize(key) {
  return key
    .split(/(\d+)/)
    .filter((s) => s !== "")
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

function compareKeys(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
      continue;
    }
    const lx = String(x).toLowerCase();
    const ly = String(y).toLowerCase();
    if (lx !== ly) return lx < ly ? -1 : 1;
    if (String(x) !== String(y)) return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

function isScalar(value) {
  return value === null || typeof value !== "object";
}

// The canonical form, matching Biome's JSON formatter: an object is always expanded with its keys
// sorted; an array of scalars is collapsed to one line when it fits the line width, otherwise
// expanded; an array holding an object or array is expanded. `prefixLen` is the number of
// characters already on the line before this value, so the fit test measures the whole line.
function serialize(value, indent, prefixLen) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isScalar)) {
      const one = `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
      if (prefixLen + one.length <= LINE_WIDTH) return one;
    }
    const pad1 = "  ".repeat(indent + 1);
    const body = value.map((v) => pad1 + serialize(v, indent + 1, pad1.length)).join(",\n");
    return `[\n${body}\n${pad}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort(compareKeys);
    if (keys.length === 0) return "{}";
    const pad1 = "  ".repeat(indent + 1);
    const body = keys
      .map((k) => {
        const head = `${pad1}${JSON.stringify(k)}: `;
        return head + serialize(value[k], indent + 1, head.length);
      })
      .join(",\n");
    return `{\n${body}\n${pad}}`;
  }
  return JSON.stringify(value);
}

function canonicalJson(doc) {
  return `${serialize(doc, 0, 0)}\n`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    command: null,
    projectDir: ".",
    recipe: null,
    recipeHash: null,
    files: [],
    skillVersion: null,
    environment: null,
    appliedAt: null,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--recipe") opts.recipe = argv[++i];
    else if (a === "--recipe-hash") opts.recipeHash = argv[++i];
    else if (a === "--file") opts.files.push(argv[++i]);
    else if (a === "--skill-version") opts.skillVersion = argv[++i];
    else if (a === "--environment") opts.environment = argv[++i];
    else if (a === "--applied-at") opts.appliedAt = argv[++i];
    else if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
    else positional.push(a);
  }
  if (positional.length > 0) opts.command = positional[0];
  if (positional.length > 1) opts.projectDir = positional[1];
  if (positional.length > 2) throw new Error(`unexpected argument: ${positional[2]}`);
  return opts;
}

// `<path>:<action>:<hash>` — the path may itself contain a colon, so split from the right.
function parseFileSpec(spec) {
  const parts = spec.split(":");
  if (parts.length < 3) throw new Error(`--file needs <path>:<action>:<hash>, got "${spec}"`);
  const hash = parts.pop();
  const action = parts.pop();
  const path = parts.join(":");
  if (!ACTIONS.includes(action)) {
    throw new Error(`--file action must be ${ACTIONS.join("|")}, got "${action}"`);
  }
  return { path, action, hash };
}

function parseEnvironment(json) {
  const parsed = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--environment must be a JSON object");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function loadManifest(projectDir) {
  const abs = join(projectDir, MANIFEST_NAME);
  if (!existsSync(abs)) {
    return { doc: { schemaVersion: SCHEMA_VERSION, recipes: [], declined: [] }, existed: false };
  }
  const parsed = JSON.parse(readFileSync(abs, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${MANIFEST_NAME} is not a JSON object`);
  }
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `${MANIFEST_NAME} schemaVersion ${parsed.schemaVersion} ≠ ${SCHEMA_VERSION} — refusing to rewrite it`,
    );
  }
  return { doc: parsed, existed: true };
}

function sortFiles(files) {
  return [...files].sort((a, b) => compareKeys(a.path, b.path) || compareKeys(a.action, b.action));
}

function record(doc, opts) {
  const files = sortFiles(opts.files.map(parseFileSpec));
  const existing = (doc.recipes ?? []).find((r) => r.id === opts.recipe);
  const entry = { id: opts.recipe, recipeHash: opts.recipeHash, files };
  const skillVersion = opts.skillVersion ?? existing?.skillVersion;
  if (skillVersion !== undefined) entry.skillVersion = skillVersion;
  // Idempotent: an unchanged re-record keeps the recorded `appliedAt`, so the bytes do not move.
  const unchanged =
    existing !== undefined &&
    existing.recipeHash === entry.recipeHash &&
    canonicalJson(sortFiles(existing.files ?? [])) === canonicalJson(files) &&
    existing.skillVersion === entry.skillVersion;
  const appliedAt = unchanged ? existing.appliedAt : (opts.appliedAt ?? new Date().toISOString());
  const next = { ...doc };
  next.recipes = [
    ...(doc.recipes ?? []).filter((r) => r.id !== opts.recipe),
    { ...entry, appliedAt },
  ];
  next.recipes.sort((a, b) => compareKeys(a.id, b.id));
  next.declined = (doc.declined ?? []).filter((d) => d.id !== opts.recipe);
  return next;
}

function decline(doc, opts) {
  const existing = (doc.declined ?? []).find((d) => d.id === opts.recipe);
  const at = existing !== undefined ? existing.at : (opts.appliedAt ?? new Date().toISOString());
  const next = { ...doc };
  next.declined = [
    ...(doc.declined ?? []).filter((d) => d.id !== opts.recipe),
    { id: opts.recipe, at },
  ];
  next.declined.sort((a, b) => compareKeys(a.id, b.id));
  next.recipes = (doc.recipes ?? []).filter((r) => r.id !== opts.recipe);
  return next;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === null) {
    throw new Error("a command is required: record | decline | canonicalize");
  }
  const { doc, existed } = loadManifest(opts.projectDir);

  let next;
  if (opts.command === "record") {
    if (opts.recipe === null) throw new Error("record needs --recipe <id>");
    if (opts.recipeHash === null) throw new Error("record needs --recipe-hash <hash>");
    next = record(doc, opts);
  } else if (opts.command === "decline") {
    if (opts.recipe === null) throw new Error("decline needs --recipe <id>");
    next = decline(doc, opts);
  } else if (opts.command === "canonicalize") {
    next = doc;
  } else {
    throw new Error(`unknown command: ${opts.command}`);
  }

  if (opts.skillVersion !== null) next.skill = { name: SKILL_NAME, version: opts.skillVersion };
  if (opts.environment !== null) next.environment = parseEnvironment(opts.environment);

  // `appliedAt` is the last write, for a human reading the file. It moves only when the document
  // does, so a no-op re-record is byte-identical.
  const changed = canonicalJson(next) !== canonicalJson(doc);
  if (changed) next.appliedAt = opts.appliedAt ?? new Date().toISOString();
  else if (doc.appliedAt !== undefined) next.appliedAt = doc.appliedAt;

  const out = canonicalJson(next);
  const abs = join(opts.projectDir, MANIFEST_NAME);
  if (existed && readFileSync(abs, "utf8") === out) return;
  writeFileSync(abs, out);
}

try {
  main();
} catch (err) {
  process.stderr.write(`manifest.mjs: ${err.message}\n`);
  process.exit(1);
}
