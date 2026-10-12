#!/usr/bin/env node
// fetch.mjs — fetch the recipe library from this repo at a pinned ref and cache it.
//
// The installed skill ships no library: it pulls `library/` from Gott50/code-quality-skills at
// runtime, pinned to a concrete commit SHA, and caches the extracted tree under
// $XDG_CACHE_HOME/code-quality-skills/<ref>/library (or ~/.cache/...). Zero dependencies, node
// builtins only — the tarball is gunzipped with node:zlib and the ustar/pax/GNU-longname headers
// are parsed by hand, so no system `tar` is required.
//
// Usage:
//   node scripts/fetch.mjs [--ref <sha>] [--cache <dir>] [--manifest <path>] [--json] [--no-record]
//
// Ref resolution: --ref wins; else `library.ref` from the manifest (--manifest, default
// ./.code-quality.json); else `main` resolved to a SHA (gh api, then unauthenticated api.github.com).
// Offline: a network failure falls back to the newest cached ref (warned on stderr); no cache at all
// is a hard error. A cache hit for the resolved ref never re-extracts.
//
// After the library is in the cache, the fetch records its pin — `{ ref, schemaVersion, contentHash }`
// — in the manifest through the canonical writer (scripts/manifest.mjs library), so a later fetch
// reads `library.ref` instead of re-resolving `main` (#130). The manifest is the apply step's
// artifact: when it does not exist there is nothing to write to, so the fetch reports and skips.
// `--no-record` skips the recording entirely.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const REPO = "Gott50/code-quality-skills";
const MANIFEST_NAME = ".code-quality.json";
const CACHE_NAME = "code-quality-skills";
const LIBRARY_DIR = "library";
const NETWORK_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    ref: null,
    cache: null,
    manifest: null,
    json: false,
    noRecord: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ref") {
      opts.ref = argv[++i];
      if (opts.ref === undefined) throw new Error("--ref needs a value");
    } else if (a === "--cache") {
      opts.cache = argv[++i];
      if (opts.cache === undefined) throw new Error("--cache needs a value");
    } else if (a === "--manifest") {
      opts.manifest = argv[++i];
      if (opts.manifest === undefined) throw new Error("--manifest needs a value");
    } else if (a === "--json") {
      opts.json = true;
    } else if (a === "--no-record") {
      opts.noRecord = true;
    } else if (a === "--help" || a === "-h") {
      opts.help = true;
    } else {
      throw new Error(`unknown option: ${a}`);
    }
  }
  return opts;
}

function printUsage() {
  process.stdout.write(
    "usage: node scripts/fetch.mjs [--ref <sha>] [--cache <dir>] [--manifest <path>] [--json] [--no-record]\n",
  );
}

// ---------------------------------------------------------------------------
// Cache location
// ---------------------------------------------------------------------------

// --cache wins, then CODE_QUALITY_CACHE, then $XDG_CACHE_HOME/code-quality-skills, then
// ~/.cache/code-quality-skills.
function resolveCacheRoot(opts) {
  if (opts.cache !== null) return resolve(opts.cache);
  const env = process.env.CODE_QUALITY_CACHE;
  if (env !== undefined && env.trim() !== "") return resolve(env);
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg !== undefined && xdg.trim() !== "" ? xdg : join(homedir(), ".cache");
  return join(base, CACHE_NAME);
}

// ---------------------------------------------------------------------------
// Ref resolution
// ---------------------------------------------------------------------------

// `library.ref` from the manifest, when the manifest exists and carries one.
function readManifestRef(manifestPath) {
  const abs = resolve(manifestPath);
  if (!existsSync(abs)) return null;
  try {
    const doc = JSON.parse(readFileSync(abs, "utf8"));
    const ref = doc?.library?.ref;
    return typeof ref === "string" && ref.length > 0 ? ref : null;
  } catch {
    return null;
  }
}

// `main` → SHA: the authenticated gh path (5000/hr) first, then the public API (60/hr).
async function resolveMainSha() {
  try {
    const out = execFileSync("gh", ["api", `repos/${REPO}/commits/main`, "--jq", ".sha"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: NETWORK_TIMEOUT_MS,
    }).trim();
    if (out !== "") return out;
  } catch {
    // gh missing, unauthenticated, or offline — fall through to the public API
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
    headers: { "User-Agent": "code-quality-setup", Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`api.github.com returned ${res.status}`);
  const json = await res.json();
  if (typeof json?.sha !== "string" || json.sha === "") {
    throw new Error("api.github.com response carried no sha");
  }
  return json.sha;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

// The whole repo in one request, gunzipped to a raw tar buffer.
async function fetchTarball(ref) {
  const res = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${ref}`, {
    headers: { "User-Agent": "code-quality-setup" },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`codeload returned ${res.status} for ${ref}`);
  return gunzipSync(Buffer.from(await res.arrayBuffer()));
}

// ---------------------------------------------------------------------------
// Tar parsing — ustar, with pax ('x') and GNU longname ('L') overrides
// ---------------------------------------------------------------------------

function isZeroBlock(buf) {
  for (let i = 0; i < 512; i++) if (buf[i] !== 0) return false;
  return true;
}

function parseNumeric(buf, start, end) {
  if (buf[start] & 0x80) {
    // base-256 (GNU extension): the high bit flags the encoding, the rest is big-endian.
    let n = buf[start] & 0x7f;
    for (let i = start + 1; i < end; i++) n = n * 256 + buf[i];
    return n;
  }
  const s = buf.subarray(start, end).toString("utf8").replace(/\0.*$/, "").trim();
  if (s === "") return 0;
  const n = Number.parseInt(s, 8);
  return Number.isNaN(n) ? 0 : n;
}

// The ustar name is split across `name` (0-100) and `prefix` (345-500).
function readName(header) {
  const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
  const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
  return prefix === "" ? name : `${prefix}/${name}`;
}

// pax extended header records: "<len> <key>=<value>\n", where <len> counts the whole record.
function parsePax(buf) {
  const out = {};
  let off = 0;
  while (off < buf.length) {
    let sp = off;
    while (sp < buf.length && buf[sp] !== 0x20) sp++;
    if (sp >= buf.length) break;
    const len = Number.parseInt(buf.subarray(off, sp).toString("utf8"), 10);
    if (!Number.isFinite(len) || len <= 0 || off + len > buf.length) break;
    const record = buf.subarray(sp + 1, off + len).toString("utf8");
    const eq = record.indexOf("=");
    if (eq !== -1) out[record.slice(0, eq)] = record.slice(eq + 1).replace(/\n$/, "");
    off += len;
  }
  return out;
}

// `<root>/library/<rel>` → `<rel>`; anything else (or an unsafe rel) → null.
function libraryRelative(name) {
  const m = /^[^/]+\/library\/(.+)$/.exec(name);
  if (m === null) return null;
  const parts = m[1].split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return m[1];
}

// Extract only the regular files under `library/` into `libraryDir`. Returns the file count.
function extractLibrary(tar, libraryDir) {
  let off = 0;
  let paxPath = null;
  let longName = null;
  let count = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (isZeroBlock(header)) break;
    const size = parseNumeric(header, 124, 136);
    const type = String.fromCharCode(header[156]);
    const dataStart = off + 512;
    const dataEnd = dataStart + size;
    const next = dataStart + Math.ceil(size / 512) * 512;

    if (type === "x") {
      paxPath = parsePax(tar.subarray(dataStart, dataEnd)).path ?? null;
    } else if (type === "L") {
      longName = tar.subarray(dataStart, dataEnd).toString("utf8").replace(/\0+$/, "");
    } else if (type === "g") {
      // global pax header — no path override we need; skip its data
    } else {
      const name = longName ?? paxPath ?? readName(header);
      longName = null;
      paxPath = null;
      const rel = libraryRelative(name);
      if (rel !== null && (type === "0" || type === "\0" || type === "7")) {
        const dest = join(libraryDir, rel);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, tar.subarray(dataStart, dataEnd));
        count++;
      }
    }
    off = next;
  }
  if (count === 0) throw new Error("tarball carried no library/ entries");
  return count;
}

// Extract into a temp sibling, then rename into place, so a killed run never leaves a partial ref.
function extractTo(tar, refDir) {
  const tmp = `${refDir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    extractLibrary(tar, join(tmp, LIBRARY_DIR));
    rmSync(refDir, { recursive: true, force: true });
    renameSync(tmp, refDir);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Content hash and schema version
// ---------------------------------------------------------------------------

function walk(dir, prefix, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) walk(join(dir, entry.name), rel, out);
    else if (entry.isFile()) out.push(rel);
  }
}

// sha256 over the tree: for each file, its library-relative path and its bytes, sorted by path —
// stable regardless of tar order.
function contentHash(libraryDir) {
  const files = [];
  walk(libraryDir, "", files);
  files.sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(join(libraryDir, rel)));
  }
  return `sha256:${hash.digest("hex")}`;
}

function readSchemaVersion(libraryDir) {
  const p = join(libraryDir, "library.json");
  if (!existsSync(p)) return null;
  try {
    const doc = JSON.parse(readFileSync(p, "utf8"));
    return typeof doc?.schemaVersion === "number" ? doc.schemaVersion : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Recording the pin
// ---------------------------------------------------------------------------

// The manifest's current `library` block, or null when the manifest is absent or unreadable.
function readManifestLibrary(manifestPath) {
  const abs = resolve(manifestPath);
  if (!existsSync(abs)) return null;
  try {
    const doc = JSON.parse(readFileSync(abs, "utf8"));
    return doc?.library ?? null;
  } catch {
    return null;
  }
}

// Record the fetched library's pin in the manifest through the canonical writer (manifest.mjs), so
// a later fetch reads `library.ref` instead of re-resolving `main` (#130). The manifest is the
// apply step's artifact: when it does not exist there is nothing to write to, so the fetch reports
// and skips. Idempotent — an unchanged pin is not re-recorded, and manifest.mjs rewrites the same
// bytes when it is.
function recordLibrary(manifestPath, ref, hash, schemaVersion) {
  const abs = resolve(manifestPath);
  if (!existsSync(abs)) {
    process.stderr.write(`fetch.mjs: no manifest at ${abs} — not recording the library pin\n`);
    return;
  }
  if (schemaVersion === null) {
    process.stderr.write(
      `fetch.mjs: the fetched library carries no schemaVersion — not recording the library pin\n`,
    );
    return;
  }
  const current = readManifestLibrary(abs);
  if (
    current !== null &&
    current.ref === ref &&
    current.schemaVersion === schemaVersion &&
    current.contentHash === hash
  ) {
    return;
  }
  const writer = join(dirname(fileURLToPath(import.meta.url)), "manifest.mjs");
  try {
    execFileSync(
      process.execPath,
      [
        writer,
        "library",
        dirname(abs),
        "--ref",
        ref,
        "--schema-version",
        String(schemaVersion),
        "--content-hash",
        hash,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (err) {
    const detail = String(err.stderr ?? "").trim() || err.message;
    process.stderr.write(`fetch.mjs: could not record the library pin: ${detail}\n`);
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function report(ref, cacheRoot, libraryDir, json, hash, schemaVersion) {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ref, cacheDir: cacheRoot, libraryDir, contentHash: hash, schemaVersion })}\n`,
    );
    return;
  }
  const row = (label, value) => process.stdout.write(`${label.padEnd(14)}${value}\n`);
  row("ref", ref);
  row("cache", cacheRoot);
  row("library", libraryDir);
  row("contentHash", hash);
  row("schemaVersion", schemaVersion);
}

// ---------------------------------------------------------------------------
// Offline fallback
// ---------------------------------------------------------------------------

// The newest cached ref (by mtime) that carries a library/, or null.
function newestCachedRef(cacheRoot) {
  if (!existsSync(cacheRoot)) return null;
  let best = null;
  let bestTime = -1;
  for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.includes(".tmp-")) continue;
    const refDir = join(cacheRoot, entry.name);
    if (!existsSync(join(refDir, LIBRARY_DIR))) continue;
    const t = statSync(refDir).mtimeMs;
    if (t > bestTime) {
      bestTime = t;
      best = entry.name;
    }
  }
  return best;
}

function fallback(cacheRoot, reason, json) {
  process.stderr.write(`fetch.mjs: ${reason}\n`);
  const ref = newestCachedRef(cacheRoot);
  if (ref === null) {
    process.stderr.write(
      `fetch.mjs: no cached library under ${cacheRoot} — cannot continue offline\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`fetch.mjs: using cached ref ${ref} (offline fallback)\n`);
  const libraryDir = join(cacheRoot, ref, LIBRARY_DIR);
  report(ref, cacheRoot, libraryDir, json, contentHash(libraryDir), readSchemaVersion(libraryDir));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }
  const cacheRoot = resolveCacheRoot(opts);
  const manifestPath = opts.manifest ?? MANIFEST_NAME;
  const manifestRef = readManifestRef(manifestPath);

  let ref = opts.ref ?? manifestRef ?? null;
  if (ref === null) {
    try {
      ref = await resolveMainSha();
    } catch (err) {
      fallback(cacheRoot, `could not resolve main: ${err.message}`, opts.json);
      return;
    }
  }

  const refDir = join(cacheRoot, ref);
  const libraryDir = join(refDir, LIBRARY_DIR);

  if (!existsSync(libraryDir)) {
    try {
      extractTo(await fetchTarball(ref), refDir);
    } catch (err) {
      fallback(cacheRoot, `fetch of ${ref} failed: ${err.message}`, opts.json);
      return;
    }
  }

  const hash = contentHash(libraryDir);
  const schemaVersion = readSchemaVersion(libraryDir);
  if (!opts.noRecord) recordLibrary(manifestPath, ref, hash, schemaVersion);
  report(ref, cacheRoot, libraryDir, opts.json, hash, schemaVersion);
}

try {
  await main();
} catch (err) {
  process.stderr.write(`fetch.mjs: ${err.message}\n`);
  process.exit(1);
}
