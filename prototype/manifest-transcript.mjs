// THROWAWAY prototype transcript — the applied-state manifest against a real fixture.
//
// Drives prototype/manifest.mjs (the pure logic) against a scratch Bun/TypeScript project and the
// REAL recipes in skills/code-quality-setup/. The frontmatter reader, the {{plan.*}} substitution
// and the create/merge apply logic are modelled on prototype/apply.mjs (branch
// prototype/recipe-contract); they are copied, not imported, because apply.mjs is a script.
//
// Writes prototype/manifest-transcript.txt. Never merged; no PR; no tests; no gates.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  emptyManifest,
  recordApply,
  recordDecline,
  classify,
  describe,
  fnv1a,
  extractBlock,
  mergeKind,
  ownedContent,
} from "./manifest.mjs";

const REPO = "/Users/timomorawitz/Documents/code-quality-skills";
const SKILL = join(REPO, "skills/code-quality-setup");
const ROOT = "/tmp/cqs-manifest-fixture";
const MANIFEST_PATH = join(ROOT, ".code-quality.json");
const TRANSCRIPT = join(REPO, "prototype/manifest-transcript.txt");
const NOW = "2026-10-08T19:30:00.000Z";
const SKILL_VERSION = "0.1.0";
const ENVIRONMENT = { packageManager: "bun", workspace: "single", languages: ["typescript"] };
// The plan's selection for this environment: two recipes applied, one declined.
const APPLIED = ["biome-assist", "tsconfig-strict"];
const DECLINED = "agent-guidance";

// --- strict-subset YAML reader (copied from prototype/apply.mjs) ---------------
const quoteBare = (j) =>
  j
    .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
    .replace(/:\s*([^"'\s,[\]{}][^,}\]]*?)\s*(?=[,}])/g, (_m, w) => `: ${JSON.stringify(w)}`)
    .replace(/([[,]\s*)([^"'\s,[\]{}][^,}\]]*?)\s*(?=[,\]])/g, (_m, p, w) => `${p}${JSON.stringify(w)}`);

function scalar(raw) {
  const v = raw.trim();
  if (v === "[]") return [];
  if (v === "{}") return {};
  if (v === "") return null;
  if (v.startsWith("[") || v.startsWith("{")) return JSON.parse(quoteBare(v));
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v.replace(/^"(.*)"$/, "$1");
}

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) throw new Error("no frontmatter");
  const root = {};
  let key = null;
  let list = null;
  let item = null;
  const flush = () => {
    if (item) list.push(item);
    item = null;
  };
  for (const line of m[1].split("\n")) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const seq = /^(\s*)- (.*)$/.exec(line);
    const kv = /^(\s*)([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (seq) {
      flush();
      item = {};
      const inner = /^([A-Za-z_][\w-]*):(.*)$/.exec(seq[2]);
      if (!inner) throw new Error(`unsupported sequence item: ${line}`);
      item[inner[1]] = scalar(inner[2]);
      continue;
    }
    if (kv && kv[1] === "") {
      flush();
      key = kv[2];
      if (kv[3].trim() === "") {
        list = [];
        root[key] = list;
      } else {
        root[key] = scalar(kv[3]);
        list = null;
      }
      continue;
    }
    if (kv) {
      (item ?? root[key])[kv[2]] = scalar(kv[3]);
      continue;
    }
    throw new Error(`unsupported line: ${line}`);
  }
  flush();
  return root;
}

const undoSection = (body, heading) => {
  const m = new RegExp(`\\n## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(body);
  return m ? m[1].trim() : "";
};

// --- recipe loading + library --------------------------------------------------
function loadRecipe(id) {
  const text = readFileSync(join(SKILL, "references/recipes", `${id}.md`), "utf8");
  const fm = parseFrontmatter(text);
  if (fm.id !== id) throw new Error(`${id}: id mismatch (${fm.id})`);
  return { ...fm, text, undo: undoSection(text, "Undo") };
}

const gateTable = (rs) => {
  const rows = [];
  for (const r of rs) for (const g of r.gates ?? []) rows.push(`| ${g.description} | \`${g.run}\` |`);
  return rows.length ? `| Gate | Command |\n|---|---|\n${rows.join("\n")}` : "_No gates wired._";
};
const detailSections = (rs) =>
  rs
    .map((r) =>
      [
        `### ${r.title}`,
        "",
        r.purpose,
        "",
        ...(r.gates ?? []).map((g) => `- Gate: \`${g.run}\` — ${g.description}`),
        ...((r.gates ?? []).length ? [""] : []),
        "Undo:",
        "",
        ...r.undo.split("\n").map((l) => (l.startsWith("- ") ? `- ${l.slice(2)}` : l)),
      ].join("\n"),
    )
    .join("\n\n");

/**
 * The library: [{ id, hash, files: [{ path, action, content }] }].
 * `content` is the rendered template — the whole file for `create`, the marked block for a
 * `markers` merge, the JSON fragment for a `json` merge. Member-scope entries are dropped in a
 * single-package repo (the root entry writes the same path).
 *
 * `hash` is the recipe's **version**: the `.md` plus the content it owns in each file. Hashing the
 * `.md` alone misses a template-only change — scenario 6 bumps `biome.json`'s `lineWidth` and the
 * `.md` is untouched — which is exactly the case the human's decision settles.
 */
const surfaceHash = (recipeText, files) =>
  fnv1a([recipeText, ...files.map((f) => `${f.path}\u0000${f.content}`)].join("\u0001"));

function buildLibrary(ids) {
  const recipes = ids.map(loadRecipe).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const PLAN = { gates: gateTable(recipes), details: detailSections(recipes) };
  const render = (t) => t.replace(/\{\{plan\.(\w+)\}\}/g, (_m, k) => PLAN[k] ?? `{{plan.${k}}}`);
  return recipes.map((r) => {
    const files = (r.files ?? [])
      .filter((f) => !(f.scope === "member" && ENVIRONMENT.workspace === "single"))
      .map((f) => {
        const rendered = render(readFileSync(join(SKILL, f.template), "utf8"));
        const kind = mergeKind({ path: f.path, action: f.action, content: rendered }, r.id);
        const content = f.action === "merge" && kind === "markers" ? extractBlock(rendered, r.id) : rendered;
        if (content === null) throw new Error(`${r.id}: ${f.path} template has no marker pair`);
        return { path: f.path, action: f.action, content };
      });
    return { id: r.id, text: r.text, hash: surfaceHash(r.text, files), files };
  });
}

// --- apply ---------------------------------------------------------------------
function writeIfChanged(path, next) {
  const prev = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (prev === next) return "no-op (identical)";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
  return prev === null ? "created" : "updated";
}

/** Add or overwrite the leaf keys the fragment names, recursively, leaving the rest. */
function mergeJson(target, frag) {
  for (const [k, v] of Object.entries(frag)) {
    const bothObjects =
      v && typeof v === "object" && !Array.isArray(v) &&
      target[k] && typeof target[k] === "object" && !Array.isArray(target[k]);
    if (bothObjects) mergeJson(target[k], v);
    else target[k] = v;
  }
}

/** Apply one recipe; return its log lines and the owned-content hashes to record. */
function applyRecipe(recipe, lib) {
  const log = [];
  const written = new Set();
  const files = [];
  for (const f of lib.files) {
    const target = join(ROOT, f.path);
    if (f.action === "create") {
      if (written.has(f.path)) {
        log.push(`${recipe.id}: ${f.path} skipped (same path already written this run)`);
        continue;
      }
      written.add(f.path);
      log.push(`${recipe.id}: create ${f.path} -> ${writeIfChanged(target, f.content)}`);
      files.push({ path: f.path, action: "create", hash: fnv1a(f.content) });
      continue;
    }
    if (f.action === "merge") {
      const kind = mergeKind(f, recipe.id);
      if (kind === "json") {
        const doc = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : {};
        mergeJson(doc, JSON.parse(f.content));
        const next = `${JSON.stringify(doc, null, 2)}\n`;
        log.push(`${recipe.id}: merge ${f.path} (json) -> ${writeIfChanged(target, next)}`);
        files.push({ path: f.path, action: "merge", hash: fnv1a(ownedContent(next, f, recipe.id)) });
        continue;
      }
      const lines = f.content.split("\n");
      const start = lines.find((l) => l.includes(`code-quality:${recipe.id}:start`));
      const end = lines.find((l) => l.includes(`code-quality:${recipe.id}:end`));
      if (!start || !end) throw new Error(`${recipe.id}: ${f.path} has no marker pair`);
      const prev = existsSync(target) ? readFileSync(target, "utf8") : "";
      const next = prev.includes(start)
        ? prev.slice(0, prev.indexOf(start)) + f.content + prev.slice(prev.indexOf(end) + end.length)
        : `${prev}${prev && !prev.endsWith("\n") ? "\n" : ""}${prev ? "\n" : ""}${f.content}\n`;
      log.push(`${recipe.id}: merge ${f.path} (markers) -> ${writeIfChanged(target, next)}`);
      files.push({ path: f.path, action: "merge", hash: fnv1a(ownedContent(next, f, recipe.id)) });
      continue;
    }
    throw new Error(`${recipe.id}: unsupported action ${f.action}`);
  }
  return { log, files };
}

// --- fixture -------------------------------------------------------------------
function writeFixture() {
  const files = {
    "package.json": `${JSON.stringify(
      {
        name: "cqs-manifest-fixture",
        version: "0.0.0",
        type: "module",
        scripts: { test: "bun test" },
        devDependencies: {},
      },
      null,
      2,
    )}\n`,
    "tsconfig.json": `${JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2)}\n`,
    "src/index.ts": 'export const hello = (): string => "hello";\n',
    "bun.lock": "# bun lockfile (fixture)\n",
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(ROOT, p)), { recursive: true });
    writeFileSync(join(ROOT, p), c);
  }
}

function snapshot() {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(ROOT, p)] = readFileSync(p, "utf8");
    }
  };
  walk(ROOT);
  return out;
}

// --- output --------------------------------------------------------------------
const out = [];
const print = (s = "") => out.push(s);
let failures = 0;
const check = (label, cond) => {
  print(`  ${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) failures += 1;
};

let library = buildLibrary(APPLIED);
let manifest = emptyManifest({
  skillName: "code-quality-setup",
  skillVersion: SKILL_VERSION,
  environment: ENVIRONMENT,
  now: NOW,
});
let appliedSnapshot = null;

function restoreFixture() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  for (const [p, c] of Object.entries(appliedSnapshot)) {
    if (p === ".code-quality.json") continue;
    mkdirSync(dirname(join(ROOT, p)), { recursive: true });
    writeFileSync(join(ROOT, p), c);
  }
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

const showManifest = () => {
  print("manifest (.code-quality.json):");
  print(JSON.stringify(manifest, null, 2));
  print("");
};
const showReport = (report) => {
  print("classify:");
  for (const l of describe(report)) print(`  ${l}`);
  print("");
};
const allIntact = (report) =>
  report.recipes.every((r) => r.files.every((f) => f.verdict === "intact"));

// ==============================================================================
print("=".repeat(78));
print("Applied-state manifest — real-fixture transcript");
print("=".repeat(78));
print("");
print(`fixture:  ${ROOT}  (bun + TypeScript, single package)`);
print(`library:  ${APPLIED.join(", ")}  (the plan's selection for this environment)`);
print(`skill:    code-quality-setup@${SKILL_VERSION}`);
print("");

// --- 1 ------------------------------------------------------------------------
print("--- 1. First apply — manifest written, every verdict intact ---");
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });
writeFixture();
const applyLog = [];
for (const id of APPLIED) {
  const recipe = library.find((l) => l.id === id);
  const { log, files } = applyRecipe(recipe, recipe);
  applyLog.push(...log);
  manifest = recordApply(manifest, {
    recipeId: id,
    recipeHash: recipe.hash,
    skillVersion: SKILL_VERSION,
    files,
    now: NOW,
  });
}
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
print("apply log:");
for (const l of applyLog) print(`  ${l}`);
print("");
showManifest();
const report1 = classify(manifest, { library, files: snapshot() });
showReport(report1);
check("every file verdict is intact", allIntact(report1));
appliedSnapshot = snapshot();
print("");

// --- 2 ------------------------------------------------------------------------
print("--- 2. Re-run — every file is a no-op, every verdict intact ---");
restoreFixture();
const rerunLog = [];
for (const id of APPLIED) {
  const recipe = library.find((l) => l.id === id);
  const { log } = applyRecipe(recipe, recipe);
  rerunLog.push(...log);
}
print("re-run log:");
for (const l of rerunLog) print(`  ${l}`);
print("");
showManifest();
const report2 = classify(manifest, { library, files: snapshot() });
showReport(report2);
check("every re-run line is a no-op", rerunLog.every((l) => l.endsWith("no-op (identical)")));
check("every file verdict is intact", allIntact(report2));
print("");

// --- 3 ------------------------------------------------------------------------
print("--- 3. Hand-edit an owned file — drifted, not overwritten ---");
restoreFixture();
const biomePath = join(ROOT, "biome.json");
writeFileSync(biomePath, `${readFileSync(biomePath, "utf8")}// hand-edited by the user\n`);
print("hand-edit: appended a line to biome.json");
print("");
showManifest();
const report3 = classify(manifest, { library, files: snapshot() });
showReport(report3);
const biome3 = report3.recipes.find((r) => r.id === "biome-assist");
check("biome-assist is drifted", biome3.state === "drifted");
check(
  "biome.json was NOT overwritten (the hand-edit survives)",
  readFileSync(biomePath, "utf8").includes("hand-edited by the user"),
);
print("(the plan reports drift and applies only on approval — nothing was rewritten)");
print("");

// --- 4 ------------------------------------------------------------------------
print("--- 4. JSON-merge ownership — an unrelated package.json edit stays intact ---");
restoreFixture();
const pkgPath = join(ROOT, "package.json");
const pkgA = JSON.parse(readFileSync(pkgPath, "utf8"));
pkgA.scripts.test = "bun test --watch";
writeFileSync(pkgPath, `${JSON.stringify(pkgA, null, 2)}\n`);
print("hand-edit: changed package.json scripts.test (owned by no recipe)");
print("");
showManifest();
const report4a = classify(manifest, { library, files: snapshot() });
showReport(report4a);
const pkgVerdicts = (report) =>
  report.recipes.map((r) => r.files.find((f) => f.path === "package.json")?.verdict);
check("both recipes' package.json stay intact", pkgVerdicts(report4a).every((v) => v === "intact"));
const pkgB = JSON.parse(readFileSync(pkgPath, "utf8"));
pkgB.scripts["format:check"] = "biome check --write .";
writeFileSync(pkgPath, `${JSON.stringify(pkgB, null, 2)}\n`);
print("hand-edit: changed package.json scripts.format:check (owned by biome-assist)");
print("");
const report4b = classify(manifest, { library, files: snapshot() });
showReport(report4b);
const biome4 = report4b.recipes.find((r) => r.id === "biome-assist");
const ts4 = report4b.recipes.find((r) => r.id === "tsconfig-strict");
check("biome-assist is drifted (its own key changed)", biome4.state === "drifted");
check("tsconfig-strict stays intact (its keys are untouched)", ts4.state === "intact");
print("");

// --- 5 ------------------------------------------------------------------------
print("--- 5. Delete an owned file — missing, then reinstated on approval ---");
restoreFixture();
rmSync(join(ROOT, "tsconfig.json"));
print("deleted: tsconfig.json");
print("");
showManifest();
const report5a = classify(manifest, { library, files: snapshot() });
print("classify (before approval):");
for (const l of describe(report5a)) print(`  ${l}`);
print("");
check(
  "tsconfig-strict is missing",
  report5a.recipes.find((r) => r.id === "tsconfig-strict").state === "missing",
);
const ts = library.find((l) => l.id === "tsconfig-strict");
const { log: reinstateLog, files: reinstateFiles } = applyRecipe(ts, ts);
manifest = recordApply(manifest, {
  recipeId: "tsconfig-strict",
  recipeHash: ts.hash,
  skillVersion: SKILL_VERSION,
  files: reinstateFiles,
  now: NOW,
});
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
print("reinstate log (on approval):");
for (const l of reinstateLog) print(`  ${l}`);
print("");
const report5b = classify(manifest, { library, files: snapshot() });
print("classify (after reinstating):");
for (const l of describe(report5b)) print(`  ${l}`);
print("");
check(
  "tsconfig-strict is intact again",
  report5b.recipes.find((r) => r.id === "tsconfig-strict").state === "intact",
);
print("");

// --- 6 ------------------------------------------------------------------------
print("--- 6. Bump the library — update, not drift ---");
restoreFixture();
const bumpedLibrary = library.map((l) => {
  if (l.id !== "biome-assist") return l;
  const files = l.files.map((f) =>
    f.path === "biome.json" && f.action === "create"
      ? { ...f, content: f.content.replace('"lineWidth": 100', '"lineWidth": 120') }
      : f,
  );
  return { ...l, files, hash: surfaceHash(l.text, files) };
});
print("library bump: biome-assist's biome.json template lineWidth 100 -> 120");
print("");
showManifest();
const report6 = classify(manifest, { library: bumpedLibrary, files: snapshot() });
showReport(report6);
const biome6 = report6.recipes.find((r) => r.id === "biome-assist");
const biomeFile6 = biome6.files.find((f) => f.path === "biome.json");
print(
  `biome.json: verdict=${biomeFile6.verdict} recordedHash=${biomeFile6.recordedHash} ` +
    `presentHash=${biomeFile6.presentHash} currentHash=${biomeFile6.currentHash} ` +
    `updateAvailable=${biomeFile6.updateAvailable}`,
);
print(
  `biome-assist recipeChanged=${biome6.recipeChanged} ` +
    "(the recipe's version covers its templates, so a template-only change moves it)",
);
print("");
check("biome.json is update, not drifted", biomeFile6.verdict === "update");
check("the file is untouched since apply (presentHash === recordedHash)", biomeFile6.presentHash === biomeFile6.recordedHash);
print("");

// --- 7 ------------------------------------------------------------------------
print("--- 7. Decline a recipe — previously declined ---");
restoreFixture();
const declinedLibrary = buildLibrary([...APPLIED, DECLINED]);
manifest = recordDecline(manifest, { recipeId: DECLINED, now: NOW });
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
print(`declined: ${DECLINED}`);
print("");
showManifest();
const report7 = classify(manifest, { library: declinedLibrary, files: snapshot() });
showReport(report7);
check(
  `${DECLINED} is declined`,
  report7.recipes.find((r) => r.id === DECLINED).state === "declined",
);
print("");

// --- 8 ------------------------------------------------------------------------
print("--- 8. Delete the manifest — degraded, library-only comparison ---");
restoreFixture();
rmSync(MANIFEST_PATH);
print("deleted: .code-quality.json");
print("");
const onDisk = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) : null;
print(`manifest on disk: ${onDisk === null ? "absent" : "present"}`);
print("");
const report8 = classify(onDisk, { library, files: snapshot() });
showReport(report8);
check("the report is degraded", report8.degraded === true);
check(
  "every library recipe reads as new",
  report8.recipes.every((r) => r.state === "new"),
);
print("");

// --- summary -------------------------------------------------------------------
print("=".repeat(78));
print(failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`);
print("=".repeat(78));

const text = `${out.join("\n")}\n`;
process.stdout.write(text);
writeFileSync(TRANSCRIPT, text);
process.exitCode = failures === 0 ? 0 : 1;
