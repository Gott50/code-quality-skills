/**
 * lcov → Istanbul coverage-final.json converter.
 *
 * Bun's coverage reporter only emits `text` and `lcov`; fallow's `--coverage`
 * flag requires Istanbul `coverage-final.json`. This script bridges the two so
 * fallow health can score CRAP against real measured coverage instead of the
 * static 85/40/0 graph estimate.
 *
 * Bun's lcov carries line hits (DA) but no per-function records (FN/FNDA), and
 * fallow needs a function map to associate coverage with functions. So this
 * script scans each source file for function declarations to build the fnMap,
 * then marks a function covered when every DA line of its body is hit in the
 * lcov. Under the repo's 100% line-coverage gate every function ends up
 * covered, so CRAP scores reflect the real measured coverage.
 *
 * Usage:
 *   bun scripts/lcov-to-istanbul.ts --lcov coverage/lcov.info --out coverage/coverage-final.json
 *
 * Defaults: --lcov ./coverage/lcov.info, --out ./coverage/coverage-final.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const lcovPath = parseArg("--lcov") ?? "coverage/lcov.info";
const outPath = parseArg("--out") ?? "coverage/coverage-final.json";

if (!existsSync(lcovPath)) {
  console.error(`lcov-to-istanbul: lcov not found at ${lcovPath}`);
  console.error(
    `Run first: bun test --coverage --coverage-reporter=lcov --coverage-dir=${"coverage"}`,
  );
  process.exit(1);
}

const text = readFileSync(lcovPath, "utf-8");

interface Pos {
  column: number;
  line: number;
}

interface IstanbulFile {
  all: boolean;
  b: Record<string, never>;
  branchMap: Record<string, never>;
  f: Record<string, number>;
  fnMap: Record<
    string,
    { name: string; decl: { start: Pos; end: Pos }; loc: { start: Pos; end: Pos } }
  >;
  path: string;
  s: Record<string, number>;
  statementMap: Record<string, { start: Pos; end: Pos }>;
}

const pos = (line: number): Pos => ({ column: 0, line });

// Find function declaration start lines in a source file. Handles function
// declarations, const arrow/function assignments, and class methods.
function findFunctions(src: string): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = [];
  const lines = src.split("\n");
  const fnRe = /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
  const constRe =
    /(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b)/;
  const methodRe = /^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    const d = l.match(fnRe);
    if (d && d[1] !== undefined) {
      out.push({ line: i + 1, name: d[1] });
      continue;
    }
    const c = l.match(constRe);
    if (c && c[1] !== undefined) {
      out.push({ line: i + 1, name: c[1] });
      continue;
    }
    const m = l.match(methodRe);
    if (m && m[1] !== undefined) out.push({ line: i + 1, name: m[1] });
  }
  return out;
}

const result: Record<string, IstanbulFile> = {};

for (const block of text.split(/(?=^SF:)/m)) {
  const lines = block.split("\n");
  const sf = lines
    .find((l) => l.startsWith("SF:"))
    ?.slice(3)
    ?.trim();
  if (!sf) continue;

  // Line hits: DA:<line>,<hits>.
  const lineHits = new Map<number, number>();
  for (const l of lines) {
    if (!l.startsWith("DA:")) continue;
    const rest = l.slice(3);
    const [line, hits] = rest.split(",");
    if (line !== undefined && hits !== undefined) lineHits.set(Number(line), Number(hits));
  }

  const abs = resolve(sf);
  const statementMap: IstanbulFile["statementMap"] = {};
  const s: IstanbulFile["s"] = {};
  let stmtIdx = 0;
  for (const [line, hits] of lineHits) {
    statementMap[String(stmtIdx)] = { end: pos(line), start: pos(line) };
    s[String(stmtIdx)] = hits;
    stmtIdx++;
  }

  const fnMap: IstanbulFile["fnMap"] = {};
  const f: IstanbulFile["f"] = {};
  const lastLine = Math.max(0, ...lineHits.keys());
  let src = "";
  try {
    src = readFileSync(abs, "utf-8");
  } catch {
    src = "";
  }
  const fns = findFunctions(src);
  fns.forEach((fn, i) => {
    const next = fns[i + 1];
    const endLine = next !== undefined ? next.line - 1 : lastLine;
    // Covered iff every DA line in the span is hit; non-DA lines
    // (declaration/brace/blank/comment — bun emits no DA for them) are ignored.
    let covered = true;
    for (let ln = fn.line; ln <= endLine; ln++) {
      if (lineHits.has(ln) && lineHits.get(ln) === 0) {
        covered = false;
        break;
      }
    }
    fnMap[String(i)] = {
      decl: { end: pos(fn.line), start: pos(fn.line) },
      loc: { end: pos(Math.max(fn.line, endLine)), start: pos(fn.line) },
      name: fn.name,
    };
    f[String(i)] = covered ? 1 : 0;
  });

  result[abs] = {
    all: true,
    // bun's lcov emits no BRDA/BRF/BRH records (verified empirically on this
    // repo's bun; even branching code with both branches taken produced none),
    // so branch maps are intentionally empty; if a future bun emits BRDA this
    // converter ignores it.
    b: {},
    branchMap: {},
    f,
    fnMap,
    path: abs,
    s,
    statementMap,
  };
}

writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`lcov-to-istanbul: wrote ${Object.keys(result).length} files to ${outPath}`);
