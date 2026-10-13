#!/usr/bin/env node
// update.mjs — the update check: detect a moved library and offer to move a consumer's setup to it.
//
// The library is fetched at a pinned commit SHA and recorded in .code-quality.json as
// `library: { ref, schemaVersion, contentHash }` (#130). This script answers one question cheaply:
// has the library moved since the recorded pin? It fetches only `library/library.json` at the
// current `main` (one small request — never the whole tarball), reads its `schemaVersion`, and
// compares the available ref to the recorded one. The ref is the decision (#112: "newer means the
// recorded SHA moved"); the index's content identity is reported alongside.
//
// Usage:
//   node scripts/update.mjs [--ref <sha>] [--manifest <path>] [--library <path>] [--json]
//   node scripts/update.mjs --apply [--ref <sha>] [--manifest <path>]
//
// The check reports one of:
//   up-to-date        the recorded ref is the available ref (exit 0)
//   update-available  the recorded ref moved (exit 0) — the recorded and available refs are named
//   incompatible      the available library's schemaVersion exceeds the one this skill implements
//                     (exit 1) — "update the skill first"
//
// `--apply` re-fetches the library at the new ref (fetch.mjs), runs the plan against it
// (plan.mjs --library <cache>), and prints the plan's update verdicts. It writes nothing itself:
// the agent applies the plan's verdicts (the existing apply), and the new pin is recorded through
// `manifest.mjs library` only after that apply.
//
// Offline with no local library (`--library`) is a clear message and a non-zero exit.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Gott50/code-quality-skills";
const MANIFEST_NAME = ".code-quality.json";
const INDEX_PATH = "library/library.json";
// The library schemaVersion this skill implements (#112). A library whose schemaVersion exceeds it
// is refused — the skill never plans recipes from a contract it does not implement.
const LIBRARY_SCHEMA_VERSION = 1;
const NETWORK_TIMEOUT_MS = 30_000;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { apply: false, help: false, json: false, library: null, manifest: null, ref: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ref") {
      opts.ref = argv[++i];
      if (opts.ref === undefined) throw new Error("--ref needs a value");
    } else if (a === "--manifest") {
      opts.manifest = argv[++i];
      if (opts.manifest === undefined) throw new Error("--manifest needs a value");
    } else if (a === "--library") {
      opts.library = argv[++i];
      if (opts.library === undefined) throw new Error("--library needs a path");
    } else if (a === "--json") {
      opts.json = true;
    } else if (a === "--apply") {
      opts.apply = true;
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
    "usage: node scripts/update.mjs [--ref <sha>] [--manifest <path>] [--library <path>] [--json]\n" +
      "       node scripts/update.mjs --apply [--ref <sha>] [--manifest <path>]\n",
  );
}

// ---------------------------------------------------------------------------
// Content identity — the sha256 convention fetch.mjs uses
// ---------------------------------------------------------------------------

// fetch.mjs hashes a tree as sha256 over each file's library-relative path, a NUL, and its bytes,
// sorted by path. The check has only `library.json`, so it hashes that one file the same way: the
// index's content identity. (The manifest's `contentHash` is the whole-tree hash the fetch
// recorded; the two are different scopes and are reported side by side, never compared.)
function contentIdentity(relPath, bytes) {
  const hash = createHash("sha256");
  hash.update(relPath);
  hash.update("\0");
  hash.update(bytes);
  return `sha256:${hash.digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

// The manifest's `library` block, or null when the manifest is absent, unreadable, or carries none.
function readManifestLibrary(manifestPath) {
  const abs = resolve(manifestPath);
  if (!existsSync(abs)) return null;
  try {
    const doc = JSON.parse(readFileSync(abs, "utf8"));
    const lib = doc?.library;
    if (lib === null || typeof lib !== "object") return null;
    return {
      ref: typeof lib.ref === "string" ? lib.ref : null,
      schemaVersion: typeof lib.schemaVersion === "number" ? lib.schemaVersion : null,
      // The manifest records fetch.mjs's whole-tree hash (recipes + templates + library.json).
      treeHash: typeof lib.contentHash === "string" ? lib.contentHash : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ref resolution
// ---------------------------------------------------------------------------

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
    headers: { Accept: "application/vnd.github+json", "User-Agent": "code-quality-setup" },
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
// The index fetch — one small request, never the tarball
// ---------------------------------------------------------------------------

// `library/library.json` at `ref`: the authenticated contents API (raw media type) first, then the
// public raw host. Returns the file's bytes.
async function fetchIndex(ref) {
  try {
    return execFileSync(
      "gh",
      [
        "api",
        `repos/${REPO}/contents/${INDEX_PATH}?ref=${ref}`,
        "-H",
        "Accept: application/vnd.github.raw",
      ],
      { encoding: "buffer", stdio: ["ignore", "pipe", "ignore"], timeout: NETWORK_TIMEOUT_MS },
    );
  } catch {
    // gh missing, unauthenticated, or offline — fall through to the public raw host
  }
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${ref}/${INDEX_PATH}`, {
    headers: { "User-Agent": "code-quality-setup" },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`raw.githubusercontent.com returned ${res.status} for ${ref}`);
  return Buffer.from(await res.arrayBuffer());
}

// The available library's identity: its ref, its index's schemaVersion, and the index's content
// identity. `--library <path>` reads a local library directory (offline, and the deterministic
// path a test uses); otherwise the index is fetched at `--ref` or `main` resolved to a SHA.
async function resolveAvailable(opts) {
  if (opts.library !== null) {
    const dir = resolve(opts.library);
    const indexPath = join(dir, "library.json");
    if (!existsSync(indexPath)) {
      throw new Error(`no library.json under ${dir}`);
    }
    const bytes = readFileSync(indexPath);
    return { bytes, ref: opts.ref ?? "local" };
  }
  const ref = opts.ref ?? (await resolveMainSha());
  return { bytes: await fetchIndex(ref), ref };
}

function parseIndex(bytes) {
  let doc;
  try {
    doc = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("the fetched library.json is not valid JSON");
  }
  const schemaVersion = typeof doc?.schemaVersion === "number" ? doc.schemaVersion : null;
  if (schemaVersion === null) throw new Error("the fetched library.json carries no schemaVersion");
  return { schemaVersion };
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

async function check(opts) {
  const manifestPath = opts.manifest ?? MANIFEST_NAME;
  const recorded = readManifestLibrary(manifestPath);
  const available = await resolveAvailable(opts);
  const { schemaVersion } = parseIndex(available.bytes);
  const availableBlock = {
    // The check has only the index file, so this is library.json's own hash — a different scope
    // from the manifest's whole-tree hash. The two are never compared; the ref is the decision.
    indexHash: contentIdentity("library.json", available.bytes),
    ref: available.ref,
    schemaVersion,
  };

  if (schemaVersion > LIBRARY_SCHEMA_VERSION) {
    return {
      available: availableBlock,
      message: `the available library is schemaVersion ${schemaVersion}; this skill implements ${LIBRARY_SCHEMA_VERSION} — update the skill first`,
      recorded,
      status: "incompatible",
    };
  }
  if (recorded === null || recorded.ref === null) {
    return {
      available: availableBlock,
      message: "no recorded library pin — the library is available to fetch",
      recorded,
      status: "update-available",
    };
  }
  if (recorded.ref === available.ref) {
    return {
      available: availableBlock,
      message: "the recorded ref is the available ref",
      recorded,
      status: "up-to-date",
    };
  }
  return {
    available: availableBlock,
    message: "the library moved — the recorded ref is not the available ref",
    recorded,
    status: "update-available",
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

// The two hashes are different scopes — the manifest's whole-tree hash vs the index file's own
// hash — so each is labeled and they are never presented as comparable.
function block(label, b, hashKey, hashName) {
  if (b === null) return `${label.padEnd(10)}—`;
  const ref = b.ref ?? "—";
  const sv = b.schemaVersion ?? "—";
  const hash = b[hashKey] ?? "—";
  return `${label.padEnd(10)}ref ${ref}  schemaVersion ${sv}  ${hashName} ${hash}`;
}

function report(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(`${result.status}\n`);
  process.stdout.write(`${block("recorded", result.recorded, "treeHash", "tree hash")}\n`);
  process.stdout.write(`${block("available", result.available, "indexHash", "index hash")}\n`);
  process.stdout.write(`${result.message}\n`);
}

// ---------------------------------------------------------------------------
// Apply — re-fetch, re-plan, print the update verdicts (writes nothing)
// ---------------------------------------------------------------------------

function apply(opts, availableRef, json) {
  const manifestPath = resolve(opts.manifest ?? MANIFEST_NAME);
  const projectDir = dirname(manifestPath);
  const fetchScript = join(SCRIPT_DIR, "fetch.mjs");
  const planScript = join(SCRIPT_DIR, "plan.mjs");

  const fetched = execFileSync(
    process.execPath,
    [fetchScript, "--ref", availableRef, "--manifest", manifestPath, "--no-record", "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const { libraryDir, contentHash, schemaVersion } = JSON.parse(fetched);

  const plan = execFileSync(process.execPath, [planScript, projectDir, "--library", libraryDir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const note =
    "This writes nothing. Apply the plan's verdicts above (the existing apply), then record the " +
    "new pin:\n" +
    `  node scripts/manifest.mjs library ${projectDir} --ref ${availableRef} ` +
    `--schema-version ${schemaVersion} --content-hash ${contentHash}\n`;

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ libraryDir, note, plan, ref: availableRef, status: "apply" })}\n`,
    );
    return;
  }
  process.stdout.write(plan);
  process.stdout.write(`\n${note}`);
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
  if (opts.apply && opts.library !== null) {
    throw new Error(
      "--apply cannot be combined with --library — it re-fetches the library at the new ref",
    );
  }

  const result = await check(opts);

  if (opts.apply) {
    if (result.status === "incompatible") {
      report(result, opts.json);
      process.exit(1);
    }
    if (result.status === "up-to-date") {
      report(result, opts.json);
      return;
    }
    apply(opts, result.available.ref, opts.json);
    return;
  }

  report(result, opts.json);
  if (result.status === "incompatible") process.exit(1);
}

try {
  await main();
} catch (err) {
  process.stderr.write(`update.mjs: ${err.message}\n`);
  process.exit(1);
}
