/**
 * The changed-lines rule (the PR rule): every instrumented line a diff against a
 * base ref adds or modifies must be executed. It layers on top of the per-file
 * floor the gate enforces — a file above its floor must not spend the slack on
 * new untested lines.
 *
 * Split out of `coverage-gate.mjs` so each file stays reviewable: the gate owns
 * the floors, this owns the diff. The recipe ships both, and the gate imports
 * this one.
 */
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

/** Vitest's default test-file pattern: `**\/*.{test,spec}.?(c|m)[jt]s?(x)`. */
export const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** A source file the gate expects the coverage report to instrument. */
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/** A changed file this rule judges: project source, not a test. */
export function isProjectSource(path) {
  return SOURCE_FILE.test(path) && !TEST_FILE.test(path);
}

// A ref is usable when it is a non-empty string: a workflow that interpolates an
// absent context (`${{ github.event.pull_request.base.sha }}` on a push) sets the
// variable to the empty string, and `git diff ""` is an error rather than a no-op.
export function resolveBaseRef() {
  const i = process.argv.indexOf("--changed-lines");
  const flag = i >= 0 ? process.argv[i + 1] : undefined;
  const ref = flag ?? process.env.CODE_QUALITY_BASE_REF;
  return ref !== undefined && ref !== "" ? ref : undefined;
}

/**
 * The lines a diff against `ref` adds or modifies, per file. The `git diff`
 * paths are repo-root-relative and the coverage report's keys absolute, so both
 * are resolved to an absolute path before matching. A diff that cannot be
 * computed is a failure, not a silent pass: a gate that cannot see the change
 * must not report it covered.
 */
export function changedLines(ref) {
  let out;
  try {
    out = execFileSync("git", ["diff", "--unified=0", "--no-color", ref, "--"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    console.error(`coverage-gate: git diff against ${ref} failed: ${err}`);
    process.exit(1);
  }
  const changed = new Map();
  let file = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      file = path === "/dev/null" ? null : path.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || file === null) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = changed.get(resolve(file)) ?? new Set();
    for (let i = 0; i < count; i++) lines.add(start + i);
    changed.set(resolve(file), lines);
  }
  return changed;
}

/**
 * The verdict for one changed file: `null` to skip it, the empty string to pass,
 * or the failure block. Only a line the report records with zero hits fails, so
 * a brace or a comment is not a finding. A changed project source file the report
 * omits is a finding on every line — the recipe sets `coverage.include`, so
 * Istanbul normally lists a new un-imported file at 0%, and this branch guards a
 * report that omits it. A changed test file, or a non-source file, is not this
 * rule's business.
 */
function fileVerdict(abs, lineSet, rec) {
  if (rec === undefined && !isProjectSource(abs)) return null;
  const label = relative(process.cwd(), abs) || abs;
  if (rec === undefined) {
    const lines = [...lineSet].sort((a, b) => a - b).join(", ");
    return `${label}\n    ${lineSet.size} uncovered changed line(s) (the file is not in the coverage report — no test loads it): ${lines}`;
  }
  const missed = [...lineSet].filter((n) => rec.lines.get(n) === 0).sort((a, b) => a - b);
  if (missed.length === 0) return "";
  return `${label}\n    ${missed.length} uncovered changed line(s): ${missed.join(", ")}`;
}

/** The changed-lines verdict for `baseRef` over the report's files. */
export function checkChangedLines(baseRef, report) {
  const byAbs = new Map(report.map((r) => [resolve(r.sf), r]));
  const uncovered = [];
  let checked = 0;
  let files = 0;
  for (const [abs, lineSet] of changedLines(baseRef)) {
    const block = fileVerdict(abs, lineSet, byAbs.get(abs));
    if (block === null) continue;
    files += 1;
    checked += lineSet.size;
    if (block !== "") uncovered.push(block);
  }
  return { checked, files, uncovered };
}
