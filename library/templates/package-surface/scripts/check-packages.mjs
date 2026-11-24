#!/usr/bin/env node
/**
 * package-surface gate — pack every published package, unpack the tarballs into
 * a scratch app, and typecheck every public entry as a strict consumer would.
 *
 * `tsc` over the sources reads what the build reads; this reads the declarations
 * the build emits, which can break while the sources pass — a type that names a
 * module its file cannot reach, or an entry whose `types` file the tarball does
 * not carry.
 *
 * Usage: node scripts/check-packages.mjs
 *
 * Exit 0 when every packed entry typechecks; exit 1 on any error or missing
 * declaration.
 */
import { spawnSync } from "node:child_process";
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
import { dirname, join, relative, resolve } from "node:path";

const MODULE_FILE = /\.(?:cjs|js|mjs)$/;
const RELATIVE_IMPORT =
  /(?:from\s*|import\s*\(\s*|import\s*|require\s*\(\s*)["'](\.[^"']+)["']/g;
const TSCONFIG = {
  compilerOptions: {
    exactOptionalPropertyTypes: true,
    lib: ["dom", "dom.iterable", "es2022"],
    module: "esnext",
    moduleResolution: "bundler",
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: "es2022",
    types: [],
  },
  include: ["consumer-*.ts"],
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isRecord(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function workspaceGlobs(root) {
  const workspaces = root.workspaces;
  if (Array.isArray(workspaces)) return workspaces;
  if (isRecord(workspaces) && Array.isArray(workspaces.packages)) return workspaces.packages;
  return [];
}

// `packages/*` is the shape every workspace uses; a literal path is taken as
// written. A deeper glob is not expanded — the gate names the packages it
// cannot see rather than guessing.
function expandGlobs(globs) {
  const out = [];
  for (const glob of globs) {
    const star = glob.indexOf("*");
    if (star < 0) {
      out.push(glob);
      continue;
    }
    const base = glob.slice(0, star).replace(/\/$/, "");
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) out.push(join(base, entry.name));
    }
  }
  return out;
}

// Only a package that declares `exports` has a public surface to check; a
// private workspace member is not published and is skipped.
function discoverPackages() {
  const root = readJson("package.json");
  const out = [];
  for (const dir of expandGlobs(workspaceGlobs(root))) {
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (manifest.exports === undefined || manifest.name === undefined) continue;
    out.push({ dir, manifest, name: manifest.name });
  }
  return out;
}

function packageManager() {
  if (existsSync("bun.lock") || existsSync("bun.lockb")) return "bun";
  if (existsSync("pnpm-lock.yaml")) return "pnpm";
  if (existsSync("package-lock.json")) return "npm";
  return "npm";
}

function packArgs(manager, dest) {
  if (manager === "bun") return ["pm", "pack", "--destination", dest];
  return ["pack", "--pack-destination", dest];
}

function pack(pkg, manager, dest) {
  mkdirSync(dest, { recursive: true });
  const run = spawnSync(manager, packArgs(manager, dest), { cwd: pkg.dir, encoding: "utf8" });
  if (run.error || run.status !== 0) {
    console.error(`package-surface: ${manager} pack failed in ${pkg.dir}`);
    process.stderr.write(`${run.stdout ?? ""}${run.stderr ?? ""}`);
    process.exit(1);
  }
  const tarball = readdirSync(dest).find((file) => file.endsWith(".tgz"));
  if (tarball === undefined) {
    console.error(`package-surface: ${manager} pack wrote no tarball in ${dest}`);
    process.exit(1);
  }
  return join(dest, tarball);
}

function unpack(tarball, target) {
  mkdirSync(target, { recursive: true });
  const run = spawnSync("tar", ["-xzf", tarball, "--strip-components=1", "-C", target], {
    encoding: "utf8",
  });
  if (run.error || run.status !== 0) {
    console.error(`package-surface: could not unpack ${tarball}`);
    process.stderr.write(run.stderr ?? "");
    process.exit(1);
  }
}

// `exports` is either a subpath map or a condition map for ".". A string is the
// "." entry's value.
function exportsSubpaths(exportsField) {
  if (!isRecord(exportsField)) return { ".": exportsField };
  const keys = Object.keys(exportsField);
  if (keys.some((key) => key.startsWith("."))) return exportsField;
  return { ".": exportsField };
}

// The `types` condition, wherever it sits in the condition tree.
function typesPath(value) {
  if (!isRecord(value)) return undefined;
  if (value.types !== undefined && !isRecord(value.types)) return value.types;
  for (const key of Object.keys(value)) {
    const found = typesPath(value[key]);
    if (found !== undefined) return found;
  }
  return undefined;
}

function publicEntries(exportsField) {
  const out = [];
  for (const [subpath, value] of Object.entries(exportsSubpaths(exportsField))) {
    if (subpath === "./package.json" || subpath.includes("*")) continue;
    out.push({ subpath, types: typesPath(value) });
  }
  return out;
}

function specifierFor(name, subpath) {
  return subpath === "." ? name : `${name}/${subpath.slice(2)}`;
}

function consumerSource(name, entries) {
  const lines = entries.map((entry) => `import "${specifierFor(name, entry.subpath)}";`);
  return `${lines.join("\n")}\n`;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function relativeSpecifiers(text) {
  const out = [];
  for (const match of text.matchAll(RELATIVE_IMPORT)) out.push(match[1]);
  return out;
}

// Node's loader takes neither a folder nor a path without its extension, so a
// relative import that names no file fails in an app even when the sources
// resolve it.
function relativeImportProblems(pkg, target) {
  const out = [];
  for (const file of walk(target, [])) {
    if (!MODULE_FILE.test(file)) continue;
    for (const spec of relativeSpecifiers(readFileSync(file, "utf8"))) {
      if (existsSync(resolve(dirname(file), spec))) continue;
      out.push({
        message: `relative import "${spec}" in ${relative(target, file)} names no file`,
        package: pkg.name,
      });
    }
  }
  return out;
}

// A build that stopped and a wrong `publishConfig.exports` path look the same
// from here: the entry names a declaration the tarball does not carry.
function missingDeclarations(pkg, target, entries) {
  const out = [];
  for (const entry of entries) {
    if (entry.types === undefined) continue;
    if (existsSync(join(target, entry.types))) continue;
    out.push({
      message: `entry "${entry.subpath}" names types ${entry.types}, absent from the tarball`,
      package: pkg.name,
    });
  }
  return out;
}

function ownerOf(line, consumers) {
  for (const consumer of consumers) {
    if (line.startsWith(`${consumer.consumer}(`)) return consumer.name;
  }
  for (const consumer of consumers) {
    if (line.includes(`node_modules/${consumer.name}/`)) return consumer.name;
  }
  return "shared";
}

// Each error is reported once, under the first package that reaches it: a
// declaration two consumers share is one finding, not one per consumer.
function parseTsc(output, consumers) {
  const seen = new Set();
  const out = [];
  for (const line of output.split("\n")) {
    if (!line.includes("error TS") || seen.has(line)) continue;
    seen.add(line);
    out.push({ message: line, package: ownerOf(line, consumers) });
  }
  return out;
}

function runTsc(scratch, consumers) {
  const tsc = join(process.cwd(), "node_modules", ".bin", "tsc");
  if (!existsSync(tsc)) {
    console.error("package-surface: node_modules/.bin/tsc is missing — install typescript");
    process.exit(1);
  }
  const run = spawnSync(tsc, ["--noEmit", "-p", join(scratch, "tsconfig.json")], {
    encoding: "utf8",
  });
  return parseTsc(`${run.stdout ?? ""}${run.stderr ?? ""}`, consumers);
}

const packages = discoverPackages();
if (packages.length === 0) {
  console.log("package-surface: no workspace package declares exports — nothing to pack");
  process.exit(0);
}

const scratchDir = mkdtempSync(join(tmpdir(), "package-surface-"));
process.on("exit", () => rmSync(scratchDir, { force: true, recursive: true }));

const packManager = packageManager();
const problems = [];
const consumerFiles = [];
for (const [index, pkg] of packages.entries()) {
  const tarball = pack(pkg, packManager, join(scratchDir, "tarballs", String(index)));
  const target = join(scratchDir, "node_modules", pkg.name);
  unpack(tarball, target);
  const entries = publicEntries(pkg.manifest.exports);
  problems.push(...missingDeclarations(pkg, target, entries));
  problems.push(...relativeImportProblems(pkg, target));
  const consumer = `consumer-${index}.ts`;
  writeFileSync(join(scratchDir, consumer), consumerSource(pkg.name, entries));
  consumerFiles.push({ consumer, name: pkg.name });
}
writeFileSync(join(scratchDir, "tsconfig.json"), `${JSON.stringify(TSCONFIG, null, 2)}\n`);
problems.push(...runTsc(scratchDir, consumerFiles));

if (problems.length > 0) {
  for (const problem of problems) console.log(`${problem.package}: ${problem.message}`);
  console.error(`\npackage-surface: ${problems.length} problem(s) in the packed surface`);
  process.exit(1);
}
console.log("package-surface: PASS — every packed entry typechecks as a strict consumer");
