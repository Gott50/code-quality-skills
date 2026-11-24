#!/usr/bin/env node
/** comment-length gate: cap the comments a change adds, and keep examples bare. */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const MARKER = ".comment-length.json";
const DEFAULT_MAX_LINES = 3;
const SOURCE_FILE = /\.(ts|tsx|mts|js|mjs|vue|svelte)$/;
const EXAMPLE_CODE = /^examples\/(?!scripts\/|experiments\/)[^/]+\/[^/]+\//;
const TOOL_DIRECTIVE =
  /eslint-disable|@ts-expect-error|svelte-ignore|@__PURE__|prettier-ignore|check-code:/;

// The marker is the opt-in: the project commits it, the recipe never writes it.
// An absent marker means the defaults, so the script is safe to run by hand.
function readConfig() {
  if (!existsSync(MARKER)) return { maxLines: DEFAULT_MAX_LINES, warnings: 0 };
  const doc = JSON.parse(readFileSync(MARKER, "utf8"));
  const maxLines = Number.isInteger(doc?.maxLines) ? doc.maxLines : DEFAULT_MAX_LINES;
  const warnings = Number.isInteger(doc?.warnings) ? doc.warnings : 0;
  return { maxLines, warnings };
}

function parseArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function git(args) {
  const run = spawnSync("git", args, { encoding: "utf8" });
  if (run.error || run.status !== 0) {
    console.error(`check-comments: git ${args.join(" ")} failed`);
    process.stderr.write(run.stderr ?? "");
    process.exit(1);
  }
  return run.stdout ?? "";
}

// The gate takes an explicit base. `--staged` is the hook's scope, `--base` is
// CI's, and the merge-base fallback is the by-hand run on a branch.
function diffArgs() {
  if (process.argv.includes("--staged")) return ["diff", "--cached", "-U0", "--diff-filter=d"];
  const base = parseArg("--base");
  if (base !== undefined) return ["diff", "-U0", "--diff-filter=d", base];
  const mergeBase = git(["merge-base", "HEAD", "origin/main"]).trim();
  return ["diff", "-U0", "--diff-filter=d", mergeBase];
}

// The new-side line numbers a diff touches, per file. A hunk header's count is
// omitted when it is 1, which is why the count falls back to one line.
function changedLines() {
  const changed = new Map();
  let file = null;
  for (const line of git(diffArgs()).split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      file = path === "/dev/null" ? null : path.replace(/^b\//, "");
      if (file !== null && !changed.has(file)) changed.set(file, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk === null || file === null) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = changed.get(file);
    for (let n = start; n < start + count; n++) lines.add(n);
  }
  return changed;
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function blockComments(text, pattern) {
  const out = [];
  for (const match of text.matchAll(pattern)) {
    const start = lineAt(text, match.index);
    const end = lineAt(text, match.index + match[0].length - 1);
    out.push({ end, start, text: match[0] });
  }
  return out;
}

function isLineComment(lines, index, consumed) {
  return !consumed.has(index + 1) && lines[index].trim().startsWith("//");
}

// A run of `//` lines is one comment: a four-line explanation is one finding,
// not four. A line whose trimmed text does not start with `//` is code with a
// trailing comment, which the cap does not measure.
function lineComments(lines, consumed) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!isLineComment(lines, i, consumed)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && isLineComment(lines, j + 1, consumed)) j++;
    out.push({ end: j + 1, start: i + 1, text: lines.slice(i, j + 1).join("\n") });
    i = j + 1;
  }
  return out;
}

function commentsOf(text) {
  const blocks = [
    ...blockComments(text, /\/\*[\s\S]*?\*\//g),
    ...blockComments(text, /<!--[\s\S]*?-->/g),
  ];
  const consumed = new Set();
  for (const block of blocks) {
    for (let n = block.start; n <= block.end; n++) consumed.add(n);
  }
  const comments = [...blocks, ...lineComments(text.split("\n"), consumed)];
  return comments.filter((comment) => !TOOL_DIRECTIVE.test(comment.text));
}

function overlaps(comment, lines) {
  for (let n = comment.start; n <= comment.end; n++) if (lines.has(n)) return true;
  return false;
}

function checkCommentLength(changed, maxLines) {
  const violations = [];
  for (const [file, lines] of changed) {
    if (!SOURCE_FILE.test(file) || !existsSync(file)) continue;
    for (const comment of commentsOf(readFileSync(file, "utf8"))) {
      const length = comment.end - comment.start + 1;
      if (length <= maxLines || !overlaps(comment, lines)) continue;
      violations.push({
        file,
        line: comment.start,
        message: `a comment runs ${length} lines; the cap is ${maxLines}`,
        rule: "comment-length",
      });
    }
  }
  return violations;
}

function exampleFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) exampleFiles(path, out);
    else if (SOURCE_FILE.test(path) && EXAMPLE_CODE.test(path)) out.push(path);
  }
  return out;
}

// Examples are read by someone learning the API, so a comment there is noise
// whatever its length. `examples/scripts/` and `examples/experiments/` are
// tooling, not examples, and keep their comments.
function checkExampleComments() {
  if (!existsSync("examples")) return [];
  const violations = [];
  for (const file of exampleFiles("examples", [])) {
    for (const comment of commentsOf(readFileSync(file, "utf8"))) {
      violations.push({
        file,
        line: comment.start,
        message: "examples carry no comments but tool directives",
        rule: "example-comments",
      });
    }
  }
  return violations;
}

const config = readConfig();
const violations = [
  ...checkCommentLength(changedLines(), config.maxLines),
  ...checkExampleComments(),
];
const count = violations.length;
console.log(`check-comments: ${count} violation(s), recorded ${config.warnings}`);

if (count > config.warnings) {
  for (const violation of violations) {
    console.log(`${violation.file}:${violation.line} ${violation.rule} ${violation.message}`);
  }
  console.error(`\ncheck-comments: ${count} violation(s) exceed the recorded ${config.warnings}`);
  process.exit(1);
}
console.log(
  `check-comments: PASS — ${count} violation(s) at or below the recorded ${config.warnings}`,
);
