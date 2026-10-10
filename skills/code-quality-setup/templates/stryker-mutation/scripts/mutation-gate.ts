/**
 * Pre-push mutation gate. Invoked explicitly by the hook (`bun <script>` under
 * Bun, `npx tsx <script>` under npm and pnpm), so it carries no shebang.
 *
 * Reads the pre-push hook stdin (one line per pushed ref:
 * `<local ref> <local sha> <remote ref> <remote sha>`), diffs the pushed
 * commits against the remote tip, and runs Stryker scoped to ONLY the changed
 * source files (via --mutate) with --incremental caching. A changed file
 * below its mutation floor fails the push.
 *
 * Scoping to changed files keeps the gate practical: a push touching one file
 * mutates that file, not the whole area. Incremental mode reuses cached
 * results for unchanged files, so retry loops after a failed push are fast.
 *
 * The Stryker exit code only enforces the mutation score, and Stryker counts
 * timed-out mutants as killed, so a clean-score run can still contain
 * timeouts. The gate therefore also parses each area's report JSON and
 * enforces the per-file mutation floor from the committed baseline
 * `.code-quality-baseline.json` (written by the skill's `score.mjs --raise`):
 * a recorded file must meet its exact `{killed, total}` fraction
 * (cross-multiplied, so no float rounding creeps in), an unrecorded file must
 * meet `gates.mutation.global`, and a timed-out mutant always fails whatever
 * the floor. With no baseline every floor is 100% — the greenfield wall.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ZERO_SHA = "0000000000000000000000000000000000000000";

/** An exact fraction, as the baseline records it — never a rounded ratio. */
interface Frac {
  killed: number;
  total: number;
}

/** The greenfield floor: 100%. */
const FULL: Frac = { killed: 1, total: 1 };

/** The baseline's mutation floors: `global` for unrecorded files, `files` per file. */
interface Floors {
  files: Record<string, Frac>;
  global: Frac;
}

// Read once at startup. An unreadable baseline fails the gate — a floor file
// that cannot be read must not silently become 100%.
function readFloors(): Floors {
  const path = resolve(ROOT, ".code-quality-baseline.json");
  if (!existsSync(path)) return { files: {}, global: FULL };
  try {
    // SAFETY: the baseline is JSON written by score.mjs; only the mutation
    // gate's `global` fraction and `files` map are read.
    const doc = JSON.parse(readFileSync(path, "utf8")) as {
      gates?: { mutation?: { files?: Record<string, Frac>; global?: Frac } };
    };
    const mutation = doc.gates?.mutation;
    return { files: mutation?.files ?? {}, global: mutation?.global ?? FULL };
  } catch (err) {
    console.error(`[mutation-gate] baseline ${path} is unreadable: ${err}`);
    process.exit(1);
  }
}

/** The floor for one file: its own if the baseline records it, else global. */
function floorOf(fileName: string, areaPrefix: string): Frac {
  // The report's keys are relative to the area the config ran in (the member
  // directory for a member config), the baseline's keys to the workspace
  // root, so the area prefix turns one into the other.
  return FLOORS.files[`${areaPrefix}${fileName}`] ?? FLOORS.files[fileName] ?? FLOORS.global;
}

const FULL_CONFIG = "stryker.conf.mjs";

// The workspace root the gate was invoked from. Stryker runs in each area's
// directory (so a member config's own globs resolve against the member), while
// the report and incremental cache stay rooted here, where `.gitignore` covers
// them.
const ROOT = process.cwd();

// The mutation floors, read once at startup. ROOT must be initialized first:
// the baseline sits at the workspace root the gate was invoked from.
const FLOORS = readFloors();

// The Stryker CLI, run through whichever package manager the project uses:
// `bunx` under Bun, `npx` under npm and pnpm. Derived from the lockfile — the
// same evidence the detector uses to name the manager, so the two never
// disagree — which lets one gate script serve every package manager.
const RUNNER = existsSync("bun.lock") || existsSync("bun.lockb") ? "bunx" : "npx";

/** Short name of a config, used for its incremental-cache file. */
function areaOf(config: string): string {
  if (config === FULL_CONFIG) return "full";
  return config.replace(/^stryker\./, "").replace(/\.conf\.mjs$/, "") || "full";
}

// The report every config writes, at the workspace root. A member config runs
// with cwd = the member directory, so its `jsonReporter.fileName` names the
// member's path back to the workspace root followed by this path — the root,
// whatever the member's depth — and the gate reads this same root path for
// every config. The incremental cache stays per-area, so members do not share
// cache state.
//
// This template is root-scoped, so it must not carry a `{{root}}` token: the
// renderer would rewrite it and `create`'s byte-compare would report drift on a
// file nobody edited. (`{{plan.*}}` keys are legal in any scope; this rule is
// about `{{root}}` alone.) Name the mechanism, never the token.
const REPORT_FILE = "reports/mutation/report.json";

/**
 * Per-file mutation levels for the changed files in a Stryker report:
 * `killed` counts `Killed` mutants only, `total` every mutant in the file,
 * and `timedOut` the `Timeout` ones (which Stryker's own score counts as
 * killed).
 *
 * With --incremental, Stryker re-emits cached files from the incremental file
 * into the report even when they are not part of the current --mutate set, so
 * levels must be scoped to the pushed files; a cached survivor from a file
 * that is not being pushed must not fail the push.
 *
 * An empty changedFiles set matches every file in the report. The full-suite
 * fallback (new branch with no merge-base) runs Stryker over the whole repo
 * and passes an empty set, so it must still be verified rather than skipped.
 */
function fileLevels(
  reportFile: string,
  changedFiles: Set<string>,
): Map<string, { killed: number; timedOut: number; total: number }> {
  const levels = new Map<string, { killed: number; timedOut: number; total: number }>();
  if (!existsSync(reportFile)) return levels;
  // SAFETY: Stryker's jsonReporter writes files[].mutants[].status as a string
  // enum; other report fields are not read by this gate.
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as {
    files?: Record<string, { mutants?: Array<{ status?: string }> }>;
  };
  for (const [fileName, file] of Object.entries(report.files ?? {})) {
    if (changedFiles.size > 0 && !changedFiles.has(fileName)) continue;
    const mutants = file.mutants ?? [];
    levels.set(fileName, {
      killed: mutants.filter((m) => m.status === "Killed").length,
      timedOut: mutants.filter((m) => m.status === "Timeout").length,
      total: mutants.length,
    });
  }
  return levels;
}

function git(args: string[]): string[] {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr?.trim()}`);
  }
  return r.stdout.split("\n").filter((l) => l.length > 0);
}

/** Files changed between the remote tip and the pushed local sha. */
function changedFiles(localSha: string, remoteSha: string): string[] {
  if (remoteSha === ZERO_SHA) {
    // New branch: diff against the merge-base with the default branch.
    const base = git(["merge-base", "HEAD", "origin/main"])[0];
    if (!base) throw new Error("no merge-base with origin/main");
    return git(["diff", "--name-only", base, localSha]);
  }
  return git(["diff", "--name-only", remoteSha, localSha]);
}

/** A config's `mutate` globs, split into the positive and negated patterns. */
interface MutateScope {
  exclude: RegExp[];
  include: RegExp[];
}

/** Regex metacharacters a glob may carry; `*` is left for the glob step. */
const REGEX_SPECIAL = ".+^${}()|[]\\";

/** Glob syntax: `**` spans any depth, `*` spans one path segment. */
function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/\*\*\/|\*\*|\*|./gs, (token) => {
    if (token === "**/") return "(?:.*/)?";
    if (token === "**") return ".*";
    if (token === "*") return "[^/]*";
    return REGEX_SPECIAL.includes(token) ? "\\" + token : token;
  });
  return new RegExp(`^${body}$`);
}

// Directory prefix -> scoped Stryker config covering that area. One catch-all
// entry for a single-package repo; a workspace adds one entry per member
// (prefix -> that member's config), which is why the mapping is a list. The
// plan renderer substitutes this literal from the detector's member list, so
// the mapping never drifts from the members on disk.
const AREA_CONFIGS: ReadonlyArray<readonly [string, string]> = {{plan.areas}};

/**
 * The config's own `mutate` globs are the mutation scope, and the gate must
 * respect them: `--mutate` on the command line OVERRIDES the config, so a
 * changed file the config would never mutate (a build script, a vendored
 * plugin) would land in the mutation set. Under the Bun runner that is fatal:
 * its preload imports every file in the set, so a script whose module-level
 * code exits non-zero kills the whole push. Filtering through the config's own
 * globs is the only way to keep such a file out.
 */
async function mutateScopeOf(config: string): Promise<MutateScope> {
  // Dynamic import: the specifier is the config path the gate was invoked with
  // (a runtime value), not a module known at author time.
  // SAFETY: the config is an ESM module whose default export is the Stryker
  // config object; only `mutate` is read, and a missing or non-array value
  // falls back to an empty scope.
  const mod = (await import(pathToFileURL(resolve(config)).href)) as {
    default?: { mutate?: string[] };
  };
  const globs = mod.default?.mutate ?? [];
  return {
    exclude: globs.filter((g) => g.startsWith("!")).map((g) => globToRegExp(g.slice(1))),
    include: globs.filter((g) => !g.startsWith("!")).map(globToRegExp),
  };
}

/** Is this file in the config's mutation scope? */
function inMutationScope(file: string, scope: MutateScope): boolean {
  return scope.include.some((re) => re.test(file)) && !scope.exclude.some((re) => re.test(file));
}

/** Map each area config to the changed source files it must mutate. */
function scopeFor(files: string[], scopes: Map<string, MutateScope>): Map<string, string[]> {
  const scope = new Map<string, string[]>();
  for (const file of files) {
    // The most specific prefix wins: a member file belongs to its member's
    // config, not to the root catch-all.
    const match = AREA_CONFIGS.filter(([prefix]) => file.startsWith(prefix)).sort(
      (a, b) => b[0].length - a[0].length,
    )[0];
    if (!match) continue;
    const [prefix, config] = match;
    const mutateScope = scopes.get(config);
    // The config's globs are relative to the area directory, so match the
    // file's path within that area.
    if (!mutateScope || !inMutationScope(file.slice(prefix.length), mutateScope)) continue;
    const list = scope.get(config) ?? [];
    list.push(file.slice(prefix.length));
    scope.set(config, list);
  }
  return scope;
}

function runStryker(config: string, files: string[]): boolean {
  const area = areaOf(config);
  // Stryker runs in the area's directory so a member config's own globs resolve
  // against the member; the report and cache stay rooted at the workspace root.
  const areaDir = AREA_CONFIGS.find(([, c]) => c === config)?.[0] ?? "";
  const incrementalFile = resolve(ROOT, `reports/mutation/incremental.${area}.json`);
  const reportFile = resolve(ROOT, REPORT_FILE);
  console.log(
    `\n[mutation-gate] ${config}: mutating ${files.length} changed file(s) ` +
      `(${files.join(", ")}) with incremental cache ${incrementalFile}`,
  );
  // Reset the report so counts reflect only this run: Stryker's jsonReporter
  // accumulates files from previous runs into the same file, so a stale
  // report could fail a push on files that are not being pushed (or pass
  // vacuously if the current files were skipped).
  rmSync(reportFile, { force: true });
  const r = spawnSync(
    RUNNER,
    [
      "stryker",
      "run",
      resolve(ROOT, config),
      "--mutate",
      files.join(","),
      "--incremental",
      "--incrementalFile",
      incrementalFile,
    ],
    { cwd: resolve(ROOT, areaDir), encoding: "utf8" },
  );
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  if (r.status !== 0) return false;
  return verifyReport(config, reportFile, r.stdout ?? "", new Set(files));
}

/**
 * A missing report fails closed — unless Stryker's own output confirms a
 * genuinely zero-mutant run. Stryker writes no report when it instruments
 * zero mutants (e.g. a push touching only type-only files); any other count
 * (or unparseable output) must not be misclassified as a clean pass. Anchor
 * on the instrumenter's own line ("Instrumented <N> source file(s) with <M>
 * mutant(s)") instead of a bare "with N mutant" phrase, so progress lines or
 * other interleaved output cannot match by noise.
 */
function reportMissing(config: string, reportFile: string, stdout: string): boolean {
  const instrumented = stdout.match(/Instrumented \d+ source file\(s\) with (\d+) mutant/);
  if (instrumented && instrumented[1] === "0") {
    console.log(`\n[mutation-gate] ${config}: no mutants instrumented, nothing to verify`);
    return true;
  }
  console.error(
    `\n[mutation-gate] ${config}: report ${reportFile} missing after run; ` +
      `cannot verify the mutation floors.`,
  );
  return false;
}

/**
 * Verify a completed Stryker run's report. The exit code only enforces the
 * mutation score, and Stryker counts timed-out mutants as killed, so a
 * clean-score run can still contain timeouts. Enforce the per-file mutation
 * floor from the baseline for the pushed files in the report — a timed-out
 * mutant fails whatever the floor. Changed files absent from the report have
 * zero mutants (or were deleted), so there is nothing to verify for them.
 */
function verifyReport(
  config: string,
  reportFile: string,
  stdout: string,
  changedFiles: Set<string>,
): boolean {
  // The area prefix turns the report's area-relative keys into the baseline's
  // workspace-root-relative ones (the member directory for a member config).
  const areaPrefix = AREA_CONFIGS.find(([, c]) => c === config)?.[0] ?? "";
  if (!existsSync(reportFile)) return reportMissing(config, reportFile, stdout);
  const failures: string[] = [];
  for (const [fileName, level] of fileLevels(reportFile, changedFiles)) {
    if (level.timedOut > 0) {
      failures.push(
        `${fileName}: ${level.timedOut} timed-out mutant(s) — timeouts fail whatever the floor`,
      );
    }
    const floor = floorOf(fileName, areaPrefix);
    if (level.total > 0 && level.killed * floor.total < floor.killed * level.total) {
      failures.push(
        `${fileName}: ${level.killed}/${level.total} killed — floor ${floor.killed}/${floor.total}`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(`\n[mutation-gate] ${config}: report ${reportFile}:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return false;
  }
  return true;
}

const stdin = readFileSync(0, "utf8").trim();
const lines = stdin.split("\n").filter((l) => l.length > 0);

if (lines.length === 0) {
  console.log("[mutation-gate] no refs pushed, skipping");
  process.exit(0);
}

const scope = new Map<string, string[]>();
const scopes = new Map<string, MutateScope>();
for (const [, config] of AREA_CONFIGS) {
  scopes.set(config, await mutateScopeOf(config));
}
let unknownBase = false;

for (const line of lines) {
  const [, localSha, , remoteSha] = line.split(/\s+/);
  if (!localSha || !remoteSha) continue;
  let files: string[];
  try {
    files = changedFiles(localSha, remoteSha);
  } catch {
    unknownBase = true;
    continue;
  }
  if (remoteSha === ZERO_SHA && files.length === 0) unknownBase = true;
  for (const [config, list] of scopeFor(files, scopes)) {
    const merged = scope.get(config) ?? [];
    scope.set(config, [...new Set([...merged, ...list])]);
  }
}

if (unknownBase) {
  console.log(
    "[mutation-gate] cannot determine changed files (new branch without origin/main); running full suite",
  );
  scope.set(FULL_CONFIG, []);
}

if (scope.size === 0) {
  console.log("[mutation-gate] no mutation-scoped source changed, skipping");
  process.exit(0);
}

let failed = false;
for (const [config, files] of scope) {
  if (!runStryker(config, files)) failed = true;
}

if (failed) {
  console.error(
    "\n[mutation-gate] FAILED: mutation testing found a file below its floor, or a timed-out mutant. Fix them before pushing.",
  );
  process.exit(1);
}
console.log("\n[mutation-gate] OK: every changed file meets its mutation floor (0 timed out)");
