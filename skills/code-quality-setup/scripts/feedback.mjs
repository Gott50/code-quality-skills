#!/usr/bin/env node
// feedback.mjs — the opt-in feedback channel (#71).
//
// Zero dependencies, node builtins only. It builds the redacted report for an unexpected failure
// (a detector hard error, a malformed recipe, a `verify` that failed for a reason the plan did not
// predict) or for the user's say-so, prints it, and prints the filing path: a prefilled GitHub
// issue URL, or `gh issue create` when the URL would exceed GitHub's length limit. It NEVER sends
// anything — the agent shows the report, and the human files it.
//
// The channel is off unless `.code-quality.json` carries `feedback: true` (written by
// `node scripts/manifest.mjs feedback [projectDir] --enable`). With the flag off this script
// prints a note to stderr and exits 0 without building a report.
//
// Usage: node scripts/feedback.mjs [projectDir] --error <text> [options]
//   --recipe <id>               the failing recipe id
//   --error <text>              the failure text (or --error-file <path>)
//   --error-file <path>         read the failure text from a file
//   --plan-excerpt <text>       the plan excerpt (or --plan-excerpt-file <path>)
//   --plan-excerpt-file <path>  read the plan excerpt from a file
//   --stack <json>              the detector's stack report (default: run detect.mjs)
//   --skill-version <v>         the skill version (default: the manifest's, else the constant)
//   --gh | --no-gh              force gh availability (default: probe `gh --version`)
//   --json                      print the machine-readable payload + filing instead of the report
//   --help                      this text
//
// The payload, the redaction rules and the opt-in flag are specified in FEEDBACK-SCHEMA.md next to
// this file; the agent-facing flow is references/feedback.md.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const SKILL_NAME = "code-quality-setup";
const SKILL_VERSION = "1";
const MANIFEST_NAME = ".code-quality.json";
const DESTINATION = "Gott50/code-quality-skills";
const LABELS = ["feedback", "needs-triage"];
// GitHub's unpublished URL length limit: the request line is capped at 8 KB and an over-long
// `issues/new` URL is answered with 414. 8000 leaves room for the scheme and host.
const MAX_URL_LENGTH = 8000;
const TITLE_MAX = 80;
const REPORT_FILE = "code-quality-feedback.md";

const USAGE = `feedback.mjs — the opt-in feedback channel (#71)

Builds the redacted report for an unexpected failure (or the user's say-so), prints it, and prints
the filing path. It never sends anything: the agent shows the report, the human files it.

Usage: node scripts/feedback.mjs [projectDir] --error <text> [options]

  --recipe <id>               the failing recipe id
  --error <text>              the failure text (or --error-file <path>)
  --error-file <path>         read the failure text from a file
  --plan-excerpt <text>       the plan excerpt (or --plan-excerpt-file <path>)
  --plan-excerpt-file <path>  read the plan excerpt from a file
  --stack <json>              the detector's stack report (default: run detect.mjs)
  --skill-version <v>         the skill version (default: the manifest's, else the constant)
  --gh | --no-gh              force gh availability (default: probe \`gh --version\`)
  --json                      print the machine-readable payload + filing instead of the report
  --help                      this text

The channel is off unless .code-quality.json carries \`feedback: true\`:

  node scripts/manifest.mjs feedback [projectDir] --enable

The payload, the redaction rules and the flag are specified in FEEDBACK-SCHEMA.md.
`;

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

// An absolute path: a POSIX path (`/a/b`) or a Windows path (`C:\a\b`). The lookbehind keeps it
// from matching a path already rewritten to `<project>` (preceded by `>`) or a fragment inside a
// word (`s/foo/bar`). The character class stops at whitespace, quotes, brackets and the
// punctuation that ends a path in prose; `:` is excluded so a trailing `:line:col` survives.
const ABS_PATH = /(?<![\w>])(?:[A-Za-z]:[\\/]|\/)[^\s"'`()\[\]{}<>|,;:]+/g;

// The plan renders a file's unified diff as 4-space-indented lines under the file's row, and the
// Losses section lists the repo's own extra lines as 2-space `  - \`…\`` bullets. Both are the
// user's source; collapse each run of diff lines to one placeholder and each lost item to one.
// The plan's other bullets sit at column 0 or 2 without the backticks, so neither shape collides.
function redactSource(text) {
  const out = [];
  let inDiff = false;
  for (const line of String(text ?? "").split("\n")) {
    if (/^ {4}[@+\- ]/.test(line)) {
      if (!inDiff) out.push("    <source omitted>");
      inDiff = true;
      continue;
    }
    inDiff = false;
    if (/^ {2}- `.*`$/.test(line)) {
      out.push("  - <source omitted>");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

// Absolute paths first (the project root becomes `<project>`, so the report keeps the relative
// shape), then any remaining absolute path, then the project's own package names. Dependency names
// are kept: they are public and they are the stack report's evidence.
function redactText(text, ctx) {
  let out = String(text ?? "");
  for (const root of ctx.roots) {
    if (root && root.length > 1) out = out.split(root).join("<project>");
  }
  out = out.replace(ABS_PATH, "<path>");
  for (const name of ctx.packageNames) {
    if (!name) continue;
    // A boundary is anything but a word character or `-`, so the name is redacted in prose, in a
    // path (`node_modules/<name>/…`) and in a filename, but a short name is not redacted inside a
    // longer word (`app` in `application`).
    const re = new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`, "g");
    out = out.replace(re, "<package>");
  }
  return out;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactValue(value, ctx) {
  if (typeof value === "string") return redactText(value, ctx);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, ctx));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(v, ctx);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

function buildPayload(ctx) {
  return {
    schemaVersion: SCHEMA_VERSION,
    skill: { name: SKILL_NAME, version: ctx.skillVersion },
    stack: ctx.stack === null ? null : redactValue(ctx.stack, ctx),
    packages: ctx.packages === null ? null : redactValue(ctx.packages, ctx),
    stackError: ctx.stackError === null ? null : redactText(ctx.stackError, ctx),
    failure: {
      recipe: ctx.recipe,
      error: redactText(ctx.error, ctx),
      planExcerpt: redactSource(redactText(ctx.planExcerpt, ctx)),
    },
    redactions: ["absolute paths", "package names", "source"],
    generatedAt: ctx.generatedAt,
  };
}

// The report is Markdown: it is both what the agent prints and the issue body.
function renderReport(payload) {
  const out = [];
  out.push("## code-quality-setup feedback");
  out.push("");
  out.push(`- **skill**: \`${payload.skill.name}\` ${payload.skill.version}`);
  out.push(`- **generated**: ${payload.generatedAt}`);
  out.push(`- **recipe**: ${payload.failure.recipe ? `\`${payload.failure.recipe}\`` : "_(none)_"}`);
  out.push("");
  out.push("### Error");
  out.push("");
  out.push("```");
  out.push(payload.failure.error || "(empty)");
  out.push("```");
  out.push("");
  out.push("### Stack");
  out.push("");
  if (payload.stackError) {
    out.push(`_The detector could not run: ${payload.stackError}_`);
    out.push("");
  }
  out.push("```json");
  out.push(JSON.stringify({ stack: payload.stack, packages: payload.packages }, null, 2));
  out.push("```");
  out.push("");
  out.push("### Plan excerpt");
  out.push("");
  out.push("```");
  out.push(payload.failure.planExcerpt || "(empty)");
  out.push("```");
  out.push("");
  out.push(`_Redacted: ${payload.redactions.join(", ")}._`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

function buildTitle(payload) {
  const first = (payload.failure.error || "").split("\n").find((l) => l.trim() !== "") ?? "";
  const head = first.trim().slice(0, TITLE_MAX);
  const recipe = payload.failure.recipe;
  const title = recipe ? `[feedback] ${recipe}: ${head}` : `[feedback] ${head}`;
  return title.trim() || "[feedback]";
}

function buildUrl(title, body) {
  const query = [
    `title=${encodeURIComponent(title)}`,
    `body=${encodeURIComponent(body)}`,
    `labels=${LABELS.map(encodeURIComponent).join(",")}`,
  ].join("&");
  return `https://github.com/${DESTINATION}/issues/new?${query}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function ghCommand(title, file) {
  return [
    "gh issue create",
    `--repo ${DESTINATION}`,
    ...LABELS.map((label) => `--label ${label}`),
    `--title ${shellQuote(title)}`,
    `--body-file ${shellQuote(file)}`,
  ].join(" ");
}

// The full report on disk, for `gh --body-file` and for the attach-it-yourself fallback. A local
// artifact, never a send.
function writeReportFile(body) {
  const path = join(tmpdir(), REPORT_FILE);
  writeFileSync(path, `${body}\n`);
  return path;
}

// No `gh` and the URL is over the limit: the largest body prefix whose URL fits, plus a marker
// pointing at the attached file. Sliced by code point so a surrogate pair is never split (which
// would make `encodeURIComponent` throw).
function truncateBody(title, body) {
  const marker = "\n\n_Truncated to fit GitHub's URL length limit — the full report is attached as a file._";
  const chars = Array.from(body);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (buildUrl(title, chars.slice(0, mid).join("") + marker).length <= MAX_URL_LENGTH) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join("") + marker;
}

function buildFiling(payload, ctx) {
  const body = renderReport(payload);
  const title = buildTitle(payload);
  const url = buildUrl(title, body);
  const urlTooLong = url.length > MAX_URL_LENGTH;
  const filing = {
    destination: DESTINATION,
    labels: LABELS,
    title,
    body,
    url,
    urlLength: url.length,
    urlTooLong,
    truncated: false,
    ghAvailable: ctx.ghAvailable,
    ghCommand: null,
    reportFile: null,
  };
  if (urlTooLong && !ctx.ghAvailable) {
    // The URL is the only path and it does not fit: truncate it and attach the full report.
    filing.truncated = true;
    filing.reportFile = writeReportFile(body);
    filing.url = buildUrl(title, truncateBody(title, body));
    filing.urlLength = filing.url.length;
  } else if (ctx.ghAvailable) {
    // `gh` is the richer path (no URL limit); the URL is still printed when it fits.
    filing.reportFile = writeReportFile(body);
    filing.ghCommand = ghCommand(title, filing.reportFile);
  }
  return filing;
}

function renderOutput(payload, filing) {
  const out = [renderReport(payload), "", "---", "", "### Filing (nothing is sent by this script)", ""];
  out.push(
    `- **destination**: \`${filing.destination}\` (labels: ${filing.labels.map((l) => `\`${l}\``).join(", ")})`,
  );
  if (filing.truncated) {
    out.push(`- **url** (truncated to fit GitHub's ${MAX_URL_LENGTH}-character limit): ${filing.url}`);
  } else if (filing.urlTooLong) {
    out.push(
      `- **url**: too long (${filing.urlLength} chars > ${MAX_URL_LENGTH}) — use the \`gh\` command below`,
    );
  } else {
    out.push(`- **url**: ${filing.url}`);
  }
  if (filing.ghCommand) out.push(`- **gh**: \`${filing.ghCommand}\``);
  if (filing.reportFile) {
    out.push(`- **report file**: \`${filing.reportFile}\`${filing.truncated ? " (attach it to the issue)" : ""}`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    projectDir: ".",
    recipe: null,
    error: null,
    errorFile: null,
    planExcerpt: null,
    planExcerptFile: null,
    stack: null,
    skillVersion: null,
    json: false,
    gh: null,
    help: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--recipe") opts.recipe = argv[++i];
    else if (a === "--error") opts.error = argv[++i];
    else if (a === "--error-file") opts.errorFile = argv[++i];
    else if (a === "--plan-excerpt") opts.planExcerpt = argv[++i];
    else if (a === "--plan-excerpt-file") opts.planExcerptFile = argv[++i];
    else if (a === "--stack") opts.stack = argv[++i];
    else if (a === "--skill-version") opts.skillVersion = argv[++i];
    else if (a === "--json") opts.json = true;
    else if (a === "--gh") opts.gh = true;
    else if (a === "--no-gh") opts.gh = false;
    else if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
    else positional.push(a);
  }
  if (positional.length > 0) opts.projectDir = positional[0];
  if (positional.length > 1) throw new Error(`unexpected argument: ${positional[1]}`);
  return opts;
}

function readManifest(projectDir) {
  const path = join(projectDir, MANIFEST_NAME);
  if (!existsSync(path)) return { doc: null, error: null };
  try {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      return { doc: null, error: "not a JSON object" };
    }
    return { doc, error: null };
  } catch (err) {
    return { doc: null, error: String(err?.message ?? err) };
  }
}

function readTextFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
  return readFileSync(path, "utf8");
}

// The detector's stack report, best-effort: a detector hard error is one of the triggers, so a
// failed run is expected and the report simply carries no stack.
function runDetector(projectDir) {
  const detectPath = fileURLToPath(new URL("./detect.mjs", import.meta.url));
  const res = spawnSync(process.execPath, [detectPath, projectDir], { encoding: "utf8" });
  if (res.error || res.status !== 0) {
    const detail = (res.stderr || res.error?.message || "").trim() || `detect.mjs exited ${res.status}`;
    return { stack: null, packages: null, error: detail };
  }
  try {
    const report = JSON.parse(res.stdout);
    return { stack: report.stack ?? null, packages: report.packages ?? null, error: null };
  } catch (err) {
    return { stack: null, packages: null, error: `detect.mjs output is not JSON: ${err.message}` };
  }
}

function ghAvailable() {
  const res = spawnSync("gh", ["--version"], { stdio: "ignore" });
  return !res.error && res.status === 0;
}

function projectRoots(projectDir) {
  const roots = new Set();
  const abs = resolve(projectDir);
  roots.add(abs);
  let real = null;
  try {
    real = realpathSync(abs);
    roots.add(real);
  } catch {
    // the project dir does not exist; the resolved path is enough
  }
  // On macOS a temp dir is a symlink (`/var/...` → `/private/var/...`): the shell's logical path
  // and the kernel's realpath differ, and an error may carry either. Add the logical path when it
  // names the same directory.
  const pwd = process.env.PWD;
  if (pwd && real !== null) {
    try {
      if (realpathSync(pwd) === real) roots.add(pwd);
    } catch {
      // PWD is stale; ignore it
    }
  }
  return [...roots].filter((r) => r && r.length > 1);
}

function packageNames(packages) {
  const names = new Set();
  for (const p of packages ?? []) {
    if (p && typeof p.name === "string" && p.name) names.add(p.name);
  }
  return [...names];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }

  const { doc, error: manifestError } = readManifest(opts.projectDir);
  if (doc?.feedback !== true) {
    const why = manifestError ? ` (${MANIFEST_NAME}: ${manifestError})` : "";
    process.stderr.write(
      `feedback.mjs: the feedback channel is off${why} — enable it with \`node scripts/manifest.mjs feedback ${opts.projectDir} --enable\`\n`,
    );
    return;
  }

  if (opts.error === null && opts.errorFile === null) {
    throw new Error("a failure is required: --error <text> or --error-file <path>");
  }
  if (opts.error !== null && opts.errorFile !== null) {
    throw new Error("give --error or --error-file, not both");
  }
  if (opts.planExcerpt !== null && opts.planExcerptFile !== null) {
    throw new Error("give --plan-excerpt or --plan-excerpt-file, not both");
  }
  const errorText =
    opts.errorFile !== null ? readTextFile(opts.errorFile, "--error-file") : opts.error;
  const planExcerpt =
    opts.planExcerptFile !== null
      ? readTextFile(opts.planExcerptFile, "--plan-excerpt-file")
      : (opts.planExcerpt ?? "");

  let stack = null;
  let packages = null;
  let stackError = null;
  if (opts.stack !== null) {
    const parsed = JSON.parse(opts.stack);
    stack = parsed?.stack ?? parsed;
    packages = parsed?.packages ?? null;
  } else {
    const detected = runDetector(opts.projectDir);
    stack = detected.stack;
    packages = detected.packages;
    stackError = detected.error;
  }

  const ctx = {
    roots: projectRoots(opts.projectDir),
    packageNames: packageNames(packages),
    recipe: opts.recipe,
    error: errorText,
    planExcerpt,
    stack,
    packages,
    stackError,
    skillVersion: opts.skillVersion ?? doc.skill?.version ?? SKILL_VERSION,
    generatedAt: new Date().toISOString(),
    ghAvailable: opts.gh ?? ghAvailable(),
  };

  const payload = buildPayload(ctx);
  const filing = buildFiling(payload, ctx);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ payload, filing }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderOutput(payload, filing)}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`feedback.mjs: ${err.message}\n`);
  process.exit(1);
}
