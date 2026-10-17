#!/usr/bin/env node
/**
 * dep-audit gate — run the pinned osv-scanner over the repo's lockfiles and
 * compare the advisory count against the floor recorded in
 * `.code-quality-baseline.json` (`gates.dep-audit.global`). The count must not
 * exceed the recorded count; with no baseline the floor is 0, the greenfield
 * wall.
 *
 * The scanner reads lockfiles, not `npm audit`, so the gate is
 * package-manager-agnostic: it scans whatever lockfile the repo carries.
 *
 * Usage:
 *   node scripts/dep-audit-gate.mjs                  scan, write the report, compare
 *   node scripts/dep-audit-gate.mjs --check          no scan: compare the existing report
 *   node scripts/dep-audit-gate.mjs --report <path>  read/write this report instead
 *   node scripts/dep-audit-gate.mjs --baseline <p>   read the floor from this baseline
 *
 * Exit 0 when the count is at or below the floor; exit 1 otherwise, and when the
 * scanner cannot run — a gate that cannot reach the advisory database must not
 * report green.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SCANNER_VERSION = "2.7.0";
const REPORT_DEFAULT = "reports/dep-audit.json";
const BASELINE_DEFAULT = ".code-quality-baseline.json";

// The pinned release asset per platform, and its sha256 from
// osv-scanner_SHA256SUMS. A binary on PATH is a property of the machine, not of
// the repo, so the gate fetches the pinned build once and caches it outside the
// repo.
const ASSETS = new Map([
  [
    "darwin-arm64",
    [
      "osv-scanner_darwin_arm64",
      "d4926ef8da134332543be276dff157e4c170f99ad91fc48e89448a8816bdf70b",
    ],
  ],
  [
    "darwin-x64",
    [
      "osv-scanner_darwin_amd64",
      "e82c5df7ab0a42dff29a1cd0660711447b56b4c0483ff66ad8634df10fd81a45",
    ],
  ],
  [
    "linux-arm64",
    ["osv-scanner_linux_arm64", "4061ef4c021ed3c47f203b818f337e351336cc5cd67c0274fc36bd1dfc728dd7"],
  ],
  [
    "linux-x64",
    ["osv-scanner_linux_amd64", "160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b"],
  ],
]);

function parseArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const checkOnly = process.argv.includes("--check");
const reportPath = parseArg("--report") ?? REPORT_DEFAULT;
const baselinePath = parseArg("--baseline") ?? BASELINE_DEFAULT;

function platformKey() {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : "";
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : "";
  if (os === "" || arch === "") {
    console.error(`dep-audit-gate: unsupported platform ${process.platform}-${process.arch}`);
    process.exit(1);
  }
  return `${os}-${arch}`;
}

function sha256(path) {
  const runs = [
    ["sha256sum", [path]],
    ["shasum", ["-a", "256", path]],
  ];
  for (const [cmd, args] of runs) {
    const run = spawnSync(cmd, args, { encoding: "utf8" });
    if (!run.error && run.status === 0) return (run.stdout ?? "").trim().split(/\s+/)[0];
  }
  console.error("dep-audit-gate: neither sha256sum nor shasum is on PATH");
  process.exit(1);
}

function ensureScanner() {
  const key = platformKey();
  const [asset, want] = ASSETS.get(key);
  const cacheRoot = process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? ".", ".cache");
  const cacheDir = join(cacheRoot, "code-quality", "osv-scanner", SCANNER_VERSION);
  const bin = join(cacheDir, "osv-scanner");
  if (existsSync(bin)) return bin;
  const url = `https://github.com/google/osv-scanner/releases/download/v${SCANNER_VERSION}/${asset}`;
  mkdirSync(cacheDir, { recursive: true });
  console.error(`dep-audit-gate: fetching osv-scanner ${SCANNER_VERSION} (${key})`);
  const dl = spawnSync("curl", ["-fsSL", url, "-o", bin], { encoding: "utf8" });
  if (dl.error || dl.status !== 0) {
    console.error(`dep-audit-gate: could not download ${url}`);
    process.exit(1);
  }
  const got = sha256(bin);
  if (got !== want) {
    console.error(`dep-audit-gate: checksum mismatch for ${asset}\n  want ${want}\n  got  ${got}`);
    process.exit(1);
  }
  chmodSync(bin, 0o755);
  return bin;
}

// One entry per advisory occurrence: the same advisory against two lockfile
// entries is two findings, so a "fix one of them" change moves the count. The
// scanner's own JSON has no top-level `findings` — it nests
// `results[].packages[].vulnerabilities[]` — so the gate normalizes it to the
// shape `score.mjs` reads.
function list(value) {
  return Array.isArray(value) ? value : [];
}

function packageFindings(pkg) {
  const meta = pkg?.package ?? {};
  const name = meta.name ?? "?";
  const version = meta.version ?? "?";
  return list(pkg?.vulnerabilities).map((vuln) => ({
    id: vuln?.id ?? "?",
    package: name,
    version,
  }));
}

function toFindings(doc) {
  const findings = [];
  for (const result of list(doc?.results)) {
    for (const pkg of list(result?.packages)) {
      findings.push(...packageFindings(pkg));
    }
  }
  return findings;
}

function runScan(bin) {
  const args = ["scan", "source", "-r", ".", "--format", "json", "--allow-no-lockfiles"];
  // A config file applies only to lockfiles in its own directory and does not
  // propagate to child directories, so it is passed explicitly to cover a
  // workspace member's lockfile too.
  if (existsSync("osv-scanner.toml")) args.push("--config", "./osv-scanner.toml");
  const run = spawnSync(bin, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error) {
    console.error(`dep-audit-gate: osv-scanner could not be run: ${run.error}`);
    process.exit(1);
  }
  const out = run.stdout ?? "";
  if (out.trim() === "") {
    console.error(
      "dep-audit-gate: osv-scanner produced no output — the advisory database was unreachable",
    );
    process.stderr.write(run.stderr ?? "");
    process.exit(1);
  }
  try {
    return JSON.parse(out);
  } catch (err) {
    console.error(`dep-audit-gate: osv-scanner output is not JSON: ${err}`);
    process.exit(1);
  }
}

// The dep-audit floor: the recorded advisory count. An unreadable baseline
// fails the gate — a floor file that cannot be read must not silently become 0.
function readFloor(path) {
  if (!existsSync(path)) return 0;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    const count = doc?.gates?.["dep-audit"]?.global;
    return Number.isInteger(count) ? count : 0;
  } catch (err) {
    console.error(`dep-audit-gate: baseline ${path} is unreadable: ${err}`);
    process.exit(1);
  }
}

function readReport(path) {
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(doc?.findings)) {
      console.error(`dep-audit-gate: ${path} carries no findings array`);
      process.exit(1);
    }
    return doc.findings;
  } catch (err) {
    console.error(`dep-audit-gate: report ${path} is unreadable: ${err}`);
    process.exit(1);
  }
}

function writeReport(path, findings) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ findings }, null, 2)}\n`);
}

const floor = readFloor(baselinePath);
let findings;
if (checkOnly) {
  findings = readReport(reportPath);
  if (findings === null) {
    console.log(
      `dep-audit-gate: --check — no report at ${reportPath}; the gate is wired and the first scan writes it`,
    );
    console.log("dep-audit-gate: PASS (dry run — no scan, no advisory database)");
    process.exit(0);
  }
} else {
  const bin = ensureScanner();
  findings = toFindings(runScan(bin));
  writeReport(reportPath, findings);
}

const count = findings.length;
const source = existsSync(baselinePath) ? baselinePath : "none — the floor is 0";
console.log(`dep-audit-gate: baseline ${source} | ${count} advisory occurrence(s), floor ${floor}`);
// Cap the listing: a debt repo can carry many advisories, and the count in the
// summary line is the gate's measure — the listing is only orientation.
const LISTED = 20;
for (const f of findings.slice(0, LISTED)) {
  console.log(`  ${f.id} ${f.package}@${f.version}`);
}
if (count > LISTED) console.log(`  … and ${count - LISTED} more`);

if (count > floor) {
  console.error(`\ndep-audit-gate: ${count} advisory occurrence(s) exceed the floor ${floor}`);
  process.exit(1);
}
console.log("dep-audit-gate: PASS — the advisory count is at or below the floor");
