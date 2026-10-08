// THROWAWAY prototype — the applied-state manifest (wayfinder ticket "Applied-state manifest:
// schema, idempotency proof, and the update path").
//
// Pure logic: no fs, no DOM, no network, no dependencies. Two worlds drive it — the shareable demo
// (manifest-demo.html, an in-memory world) and the real fixture run (manifest-transcript.mjs, a
// scratch directory) — so the state model is exercised twice against two different filesystems.
//
// The decision this prototype settles lives in the ticket's resolution comment. This file is the
// primary source, kept on branch prototype/manifest, never merged.
//
// THE PRECEDENCE RULE, in one line: the filesystem wins. The manifest is an index of what the skill
// wrote, never a claim about what is true. classify() reads the filesystem for presence and
// content, and consults the manifest for exactly one fact the filesystem cannot supply: which bytes
// the skill wrote last time. A manifest that is missing, stale or corrupt degrades the report to
// "compare against the current library only" — it never makes the report wrong.
//
// A `merge` entry owns only PART of a shared file, and the contract has two kinds (RECIPE-CONTRACT.md):
//   - `markers` — a marker-delimited block (`code-quality:<id>:start` … `:end`), e.g. `.husky/pre-commit`.
//   - `json`    — a recursive key fragment: the leaf keys the template names, e.g. `package.json`.
// The owned content is what the manifest hashes and what drift is measured against, so an unrelated
// edit elsewhere in `package.json` must stay `intact` while an edit to the recipe's own key reads
// `drifted`.

export const SCHEMA_VERSION = 1;

/** 8-hex-char FNV-1a. The real implementation uses sha256; only the shape matters here. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * A fresh manifest. `environment` is the detected stack the recipes were applied against
 * (packageManager / workspace / languages) — recorded so a later run can tell that the ground moved
 * under an applied recipe.
 */
export function emptyManifest({ skillName, skillVersion, environment, now }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    skill: { name: skillName, version: skillVersion },
    appliedAt: now,
    environment: { ...environment },
    recipes: [],
    declined: [],
  };
}

/**
 * Record one recipe as applied. Called once per recipe, after that recipe's verify passed — a
 * recipe whose verify failed is never recorded, so a re-run resumes there.
 *
 * `files` is what the recipe actually wrote: [{ path, action, hash }], the hash of the content the
 * recipe OWNS in that file — the whole file for `create`, the marked block or the named JSON leaves
 * for `merge` (see `ownedContent`).
 */
export function recordApply(manifest, { recipeId, recipeHash, skillVersion, files, now }) {
  const next = clone(manifest);
  next.appliedAt = now;
  if (skillVersion) next.skill.version = skillVersion;
  next.recipes = next.recipes.filter((r) => r.id !== recipeId);
  next.recipes.push({
    id: recipeId,
    skillVersion: skillVersion ?? next.skill.version,
    recipeHash,
    appliedAt: now,
    files: files.map((f) => ({ path: f.path, action: f.action, hash: f.hash })),
  });
  next.recipes.sort((a, b) => (a.id < b.id ? -1 : 1));
  next.declined = next.declined.filter((d) => d.id !== recipeId);
  return next;
}

/**
 * Record a recipe the user declined. A decline is a decision, not an absence: a re-run reports
 * "previously declined" and asks again, rather than silently re-proposing it as new or silently
 * skipping it.
 */
export function recordDecline(manifest, { recipeId, now }) {
  const next = clone(manifest);
  next.declined = next.declined.filter((d) => d.id !== recipeId);
  next.declined.push({ id: recipeId, at: now });
  next.declined.sort((a, b) => (a.id < b.id ? -1 : 1));
  return next;
}

/** The marked block a `markers` merge owns inside a shared file, or null when it is not there. */
export function extractBlock(fileContent, recipeId) {
  const start = `code-quality:${recipeId}:start`;
  const end = `code-quality:${recipeId}:end`;
  const lines = fileContent.split("\n");
  const i = lines.findIndex((line) => line.includes(start));
  const j = lines.findIndex((line) => line.includes(end));
  if (i === -1 || j === -1 || j < i) return null;
  return lines.slice(i, j + 1).join("\n");
}

const MISSING = Symbol("missing");

/** The fragment's named leaves, picked out of `doc`; MISSING when any of them is absent. */
function pick(doc, frag) {
  if (frag === null || typeof frag !== "object" || Array.isArray(frag)) {
    return doc === undefined ? MISSING : doc;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return MISSING;
  const out = {};
  for (const [key, value] of Object.entries(frag)) {
    if (!(key in doc)) return MISSING;
    const sub = pick(doc[key], value);
    if (sub === MISSING) return MISSING;
    out[key] = sub;
  }
  return out;
}

/** Which kind of merge an entry is: a marker block, or a recursive JSON fragment. */
export function mergeKind(entry, recipeId) {
  if (entry.content.includes(`code-quality:${recipeId}:start`)) return "markers";
  if (entry.path.endsWith(".json")) return "json";
  return "markers";
}

/** The canonical string the library would write for this entry right now. */
export function currentOwned(entry, recipeId) {
  if (entry.action !== "merge") return entry.content;
  if (mergeKind(entry, recipeId) === "json") return JSON.stringify(JSON.parse(entry.content));
  return entry.content;
}

/** The canonical string this recipe owns inside `fileContent`, or null when it is not there. */
export function ownedContent(fileContent, entry, recipeId) {
  if (fileContent === null || fileContent === undefined) return null;
  if (entry.action !== "merge") return fileContent;
  if (mergeKind(entry, recipeId) === "json") {
    let doc;
    try {
      doc = JSON.parse(fileContent);
    } catch {
      return null;
    }
    const picked = pick(doc, JSON.parse(entry.content));
    return picked === MISSING ? null : JSON.stringify(picked);
  }
  return extractBlock(fileContent, recipeId);
}

const RANK = { missing: 4, drifted: 3, update: 2, intact: 1 };

function rollUp(fileVerdicts) {
  let worst = "intact";
  for (const f of fileVerdicts) if (RANK[f.verdict] > RANK[worst]) worst = f.verdict;
  return worst;
}

/**
 * The plan's verdicts, computed from the filesystem.
 *
 * `library` is the current recipe library: [{ id, hash, files: [{ path, action, content }] }],
 * where `content` is the rendered template (the whole file for `create`, the marked block or the
 * JSON fragment for `merge`). `files` is the project's filesystem: { [path]: content }, absent
 * meaning not present.
 *
 * Per file, four verdicts:
 *   intact   — present and byte-identical to what the library would write now
 *   update   — present, untouched since apply, but the library's render changed
 *   drifted  — present but hand-edited since apply (an update may also be pending)
 *   missing  — absent, or the recipe's own block/leaves are gone
 *
 * Per recipe, the worst file verdict wins; a recipe the manifest does not know is `new`, one the
 * library no longer selects is `stale`, and one the user declined is `declined`.
 */
export function classify(manifest, { library, files, hash = fnv1a }) {
  const degraded = !manifest || manifest.schemaVersion !== SCHEMA_VERSION;
  const recorded = new Map((manifest?.recipes ?? []).map((r) => [r.id, r]));
  const declined = new Set((manifest?.declined ?? []).map((d) => d.id));
  const known = new Set(library.map((r) => r.id));

  const recipes = [];

  for (const lib of library) {
    const rec = recorded.get(lib.id);
    if (!rec) {
      recipes.push({ id: lib.id, state: declined.has(lib.id) ? "declined" : "new", files: [] });
      continue;
    }
    const fileVerdicts = lib.files.map((f) => {
      const recFile = rec.files.find((x) => x.path === f.path && x.action === f.action);
      const recordedHash = recFile ? recFile.hash : null;
      const currentHash = hash(currentOwned(f, lib.id));
      const present = ownedContent(files[f.path] ?? null, f, lib.id);
      const presentHash = present === null ? null : hash(present);
      let verdict;
      if (presentHash === null) verdict = "missing";
      else if (presentHash === currentHash) verdict = "intact";
      else if (recordedHash !== null && presentHash === recordedHash) verdict = "update";
      else verdict = "drifted";
      return {
        path: f.path,
        action: f.action,
        kind: f.action === "merge" ? mergeKind(f, lib.id) : null,
        verdict,
        updateAvailable: recordedHash !== null && recordedHash !== currentHash,
        recordedHash,
        currentHash,
        presentHash,
      };
    });
    recipes.push({
      id: lib.id,
      state: rollUp(fileVerdicts),
      recipeChanged: rec.recipeHash !== lib.hash,
      files: fileVerdicts,
    });
  }

  for (const rec of manifest?.recipes ?? []) {
    if (!known.has(rec.id)) recipes.push({ id: rec.id, state: "stale", files: [] });
  }

  const summary = {
    intact: [],
    update: [],
    drifted: [],
    missing: [],
    new: [],
    stale: [],
    declined: [],
  };
  for (const r of recipes) summary[r.state].push(r.id);

  return { degraded, recipes, summary };
}

/** One line per recipe, for a transcript or a state panel. */
export function describe(report) {
  const lines = [];
  if (report.degraded) {
    lines.push("manifest: absent or unreadable — comparing against the current library only");
  }
  for (const r of report.recipes) {
    const files = r.files
      .map(
        (f) =>
          `${f.path} [${f.verdict}${f.updateAvailable && f.verdict !== "update" ? "+update" : ""}]`,
      )
      .join(", ");
    lines.push(`${r.id}: ${r.state}${files ? ` — ${files}` : ""}`);
  }
  return lines;
}
