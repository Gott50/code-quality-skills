/**
 * Pre-push mutation gate. Invoked explicitly by the hook (`bun <script>` under
 * Bun, `npx tsx <script>` under npm and pnpm), so it carries no shebang.
 *
 * Reads the pre-push hook stdin (`<local ref> <local sha> <remote ref> <remote
 * sha>` per line), diffs the pushed commits against the remote tip, and runs
 * Stryker scoped to ONLY the changed source files (via --mutate) with
 * --incremental caching. A changed file below its mutation floor fails the push.
 *
 * The Stryker exit code only enforces the mutation score, and Stryker counts
 * timed-out mutants as killed, so a clean-score run can still contain timeouts.
 * The gate therefore also parses each area's report JSON and enforces the
 * per-file floor from the committed baseline `.code-quality-baseline.json`
 * (written by `score.mjs --raise`): a recorded file must meet its exact
 * `{killed, total}` fraction (cross-multiplied, so no float rounding creeps
 * in), an unrecorded file must meet `gates.mutation.global`, and a timed-out
 * mutant always fails whatever the floor. With no baseline every floor is 100%.
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

/**
 * Per-file mutation levels: `killed` counts `Killed` mutants only, `total`
 * every mutant, `timedOut` the `Timeout` ones (which Stryker's own score counts
 * as killed), and `zeroTestSurvivors` the covered survivors whose mutant run
 * executed zero tests.
 */
interface Level {
  killed: number;
  timedOut: number;
  total: number;
  zeroTestSurvivors: number;
}

// An unreadable baseline fails the gate — it must not silently become 100%.
function readFloors(): Floors {
  const path = resolve(ROOT, ".code-quality-baseline.json");
  if (!existsSync(path)) return { files: {}, global: FULL };
  try {
    // The parse is unannotated on purpose: `JSON.parse` returns `any`, so the
    // `gates.mutation` block is read through the `Floors` return type. An
    // `as { … }` here would assert the shape instead of checking it, which the
    // anti-slop rule flags.
    const doc = JSON.parse(readFileSync(path, "utf8"));
    const mutation = doc?.gates?.mutation;
    return { files: mutation?.files ?? {}, global: mutation?.global ?? FULL };
  } catch (err) {
    console.error(`[mutation-gate] baseline ${path} is unreadable: ${err}`);
    process.exit(1);
  }
}

/** The floor for one file: its own if the baseline records it, else global. */
function floorOf(fileName: string, areaPrefix: string): Frac {
  // The report's keys are area-relative, the baseline's workspace-root-relative,
  // so the area prefix turns one into the other.
  return FLOORS.files[`${areaPrefix}${fileName}`] ?? FLOORS.files[fileName] ?? FLOORS.global;
}

const FULL_CONFIG = "stryker.conf.mjs";

// The workspace root the gate was invoked from. Stryker runs in each area's
// directory, while the report and incremental cache stay rooted here.
const ROOT = process.cwd();

// The mutation floors, read once at startup (ROOT must be initialized first).
const FLOORS = readFloors();

// The Stryker CLI, run through the project's package manager: `bunx` under Bun,
// `npx` under npm and pnpm. Derived from the lockfile, the same evidence the
// detector uses, so the two never disagree.
const RUNNER = existsSync("bun.lock") || existsSync("bun.lockb") ? "bunx" : "npx";

/** Short name of a config, used for its incremental-cache file. */
function areaOf(config: string): string {
  if (config === FULL_CONFIG) return "full";
  return config.replace(/^stryker\./, "").replace(/\.conf\.mjs$/, "") || "full";
}

// The gate's own report, written beside the FULL-run report `score.mjs --raise`
// reads so the scoped run never clobbers it (#102). Root-scoped: no root token.
const SCOPED_REPORT_FILE = "reports/mutation/report.scoped.json";

/**
 * Per-file mutation levels for the changed files in a Stryker report. With
 * --incremental, Stryker re-emits cached files into the report even when they
 * are not in the current --mutate set, so levels are scoped to the pushed
 * files. An empty `changed` set matches every file (the full-suite fallback
 * for a new branch with no merge-base), so it must still be verified.
 */
function fileLevels(reportFile: string, changed: Set<string>): Map<string, Level> {
  const levels = new Map<string, Level>();
  if (!existsSync(reportFile)) return levels;
  // The parse is unannotated on purpose: `JSON.parse` returns `any`, so the
  // report's `files` map is read directly. An `as { … }` here would assert the
  // shape instead of checking it, which the anti-slop rule flags.
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  for (const [fileName, file] of Object.entries(report?.files ?? {})) {
    if (changed.size > 0 && !changed.has(fileName)) continue;
    const mutants = file.mutants ?? [];
    levels.set(fileName, {
      killed: mutants.filter((m) => m.status === "Killed").length,
      timedOut: mutants.filter((m) => m.status === "Timeout").length,
      total: mutants.length,
      // A covered survivor whose mutant run executed zero tests is the
      // silent-zero-tests failure mode: the per-test filter matched nothing, so
      // "Survived" is meaningless (stryker-js#6210).
      zeroTestSurvivors: mutants.filter(
        (m) =>
          m.status === "Survived" &&
          (m.coveredBy?.length ?? 0) > 0 &&
          (m.testsCompleted ?? 0) === 0,
      ).length,
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
// entry for a single-package repo; a workspace adds one per member. The plan
// renderer substitutes this literal from the detector's member list.
const AREA_CONFIGS: ReadonlyArray<readonly [string, string]> = {{plan.areas}};

/**
 * The config's own `mutate` globs are the mutation scope: `--mutate` on the
 * command line OVERRIDES the config, so a file the config would never mutate
 * (a build script, a vendored plugin) would land in the set — fatal under the
 * Bun runner, whose preload imports every file in it.
 */
async function mutateScopeOf(config: string): Promise<MutateScope> {
  // Dynamic import: the specifier is a runtime value, not a module known at author time.
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
    // The most specific prefix wins: a member file belongs to its member's config.
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
  const reportFile = resolve(ROOT, SCOPED_REPORT_FILE);
  console.log(
    `\n[mutation-gate] ${config}: mutating ${files.length} changed file(s) ` +
      `(${files.join(", ")}) with incremental cache ${incrementalFile}`,
  );
  // Reset the report so counts reflect only this run: Stryker's jsonReporter
  // accumulates files from previous runs into the same file.
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
      "--jsonReporter.fileName",
      SCOPED_REPORT_FILE,
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
 * genuinely zero-mutant run. Anchor on the instrumenter's own line
 * ("Instrumented <N> source file(s) with <M> mutant(s)") so progress lines
 * cannot match by noise.
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
 * The failure messages for one file's mutation level: a covered survivor whose
 * mutant run executed zero tests (stryker-js#6210), any timed-out mutant, and
 * a kill fraction below the file's floor.
 */
function fileFailures(fileName: string, level: Level, areaPrefix: string): string[] {
  const failures: string[] = [];
  if (level.zeroTestSurvivors > 0) {
    failures.push(
      `${fileName}: ${level.zeroTestSurvivors} covered mutant(s) survived with 0 tests run — ` +
        `the test runner's per-test filter matched nothing (stryker-js#6210); the score is not trustworthy`,
    );
  }
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
  return failures;
}

/**
 * Verify a completed Stryker run's report: enforce the per-file floor for the
 * pushed files, fail on any timed-out mutant, and fail on a covered survivor
 * whose mutant run executed zero tests (stryker-js#6210). Changed files absent
 * from the report have zero mutants (or were deleted), so nothing to verify.
 */
function verifyReport(
  config: string,
  reportFile: string,
  stdout: string,
  changed: Set<string>,
): boolean {
  // The area prefix turns the report's area-relative keys into the baseline's
  // workspace-root-relative ones (the member directory for a member config).
  const areaPrefix = AREA_CONFIGS.find(([, c]) => c === config)?.[0] ?? "";
  if (!existsSync(reportFile)) return reportMissing(config, reportFile, stdout);
  const failures: string[] = [];
  for (const [fileName, level] of fileLevels(reportFile, changed)) {
    failures.push(...fileFailures(fileName, level, areaPrefix));
  }
  if (failures.length === 0) return true;
  console.error(`\n[mutation-gate] ${config}: report ${reportFile}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  return false;
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
