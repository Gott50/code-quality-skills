// THROWAWAY stand-in for the skill's own audit→plan→apply engine (tickets: the detector script and
// its applicability matrix; the applied-state manifest). It exists only to apply the two prototype
// recipes to a scratch project by hand, repeatably, so the contract's friction is observable.
// It is NOT the deliverable: no drift report, no approval gate, no manifest, no plan rendering.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

const SKILL = "/Users/timomorawitz/Documents/code-quality-skills/skills/code-quality-setup";
const ROOT = process.argv[2] ?? "/tmp/cqs-fixture";
const SELECTED = ["biome-assist", "agent-guidance"];

// --- strict-subset YAML reader (see RECIPE-CONTRACT.md "Reader rules") ---------
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

const section = (body, heading) => {
  const m = new RegExp(`\\n## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(body);
  return m ? m[1].trim() : "";
};

const recipes = SELECTED.map((id) => {
  const text = readFileSync(join(SKILL, "references/recipes", `${id}.md`), "utf8");
  const fm = parseFrontmatter(text);
  if (fm.id !== id) throw new Error(`${id}: id mismatch`);
  return { ...fm, body: text.slice(text.indexOf("\n---\n") + 5), undo: section(text, "Undo") };
}).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

// --- substitution --------------------------------------------------------------
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
        ...(r.gates ?? []).length ? [""] : [],
        "Undo:",
        "",
        ...r.undo.split("\n").map((l) => (l.startsWith("- ") ? `- ${l.slice(2)}` : l)),
      ].join("\n"),
    )
    .join("\n\n");
const PLAN = { gates: gateTable(recipes), details: detailSections(recipes) };
const render = (t) => t.replace(/\{\{plan\.(\w+)\}\}/g, (_m, k) => PLAN[k] ?? `{{plan.${k}}}`);
const templateOf = (r, f) => render(readFileSync(join(SKILL, f.template), "utf8"));

// --- apply ---------------------------------------------------------------------
const log = [];
const writeIfChanged = (path, next) => {
  const prev = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (prev === next) return "no-op (identical)";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
  return prev === null ? "created" : "updated";
};

for (const r of recipes) {
  const writtenPaths = new Set();
  for (const f of r.files ?? []) {
    const target = join(ROOT, f.path);
    const rendered = templateOf(r, f);
    if (f.action === "create") {
      if (writtenPaths.has(f.path)) {
        log.push(`${r.id}: ${f.path} skipped (same path already written this run)`);
        continue;
      }
      writtenPaths.add(f.path);
      log.push(`${r.id}: create ${f.path} -> ${writeIfChanged(target, rendered)}`);
      continue;
    }
    if (f.action === "merge") {
      if (f.path.endsWith(".json")) {
        const frag = JSON.parse(rendered);
        const pkg = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : {};
        const collisions = [];
        for (const [section_, entries] of Object.entries(frag)) {
          pkg[section_] ??= {};
          for (const [k, v] of Object.entries(entries)) {
            if (k in pkg[section_] && pkg[section_][k] !== v) collisions.push(`${section_}.${k}`);
            else pkg[section_][k] = v;
          }
        }
        log.push(
          `${r.id}: merge ${f.path} -> ${writeIfChanged(target, `${JSON.stringify(pkg, null, 2)}\n`)}${
            collisions.length ? ` COLLISION ${collisions.join(",")}` : ""
          }`,
        );
        continue;
      }
      // The marker lines are the template's own lines containing code-quality:<id>:start/:end —
      // their comment syntax must be valid in the target language (see RECIPE-CONTRACT.md).
      const start = rendered.split("\n").find((l) => l.includes(`code-quality:${r.id}:start`));
      const end = rendered.split("\n").find((l) => l.includes(`code-quality:${r.id}:end`));
      if (!start || !end) throw new Error(`${r.id}: ${f.path} template has no marker pair`);
      const block = rendered.slice(rendered.indexOf(start), rendered.indexOf(end) + end.length);
      const prev = existsSync(target) ? readFileSync(target, "utf8") : "";
      const next = prev.includes(start)
        ? prev.slice(0, prev.indexOf(start)) + block + prev.slice(prev.indexOf(end) + end.length)
        : `${prev}${prev && !prev.endsWith("\n") ? "\n" : ""}${prev ? "\n" : ""}${block}\n`;
      log.push(`${r.id}: merge ${f.path} -> ${writeIfChanged(target, next)}`);
      continue;
    }
    throw new Error(`${r.id}: unsupported action ${f.action}`);
  }
  for (const c of r.commands ?? []) {
    execSync(c.run, { cwd: ROOT, stdio: "pipe" });
    log.push(`${r.id}: command ${c.showInPlan === false ? "(silent) " : ""}${c.run} -> ok`);
  }
  for (const v of r.verify ?? []) {
    const cmd = v.gate ? (r.gates ?? []).find((g) => g.id === v.gate).run : v.run;
    try {
      execSync(cmd, { cwd: ROOT, stdio: "pipe" });
      log.push(`${r.id}: verify ${cmd} -> exit 0`);
    } catch (e) {
      log.push(`${r.id}: verify ${cmd} -> FAILED (exit ${e.status})`);
      process.exitCode = 1;
    }
  }
}
console.log(log.join("\n"));
