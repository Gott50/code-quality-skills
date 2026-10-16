/**
 * Coverage ignore-list audit — every `coverage.exclude` entry must name a file
 * the test runner cannot execute. The Vitest twin of the Bun recipe's
 * `scripts/coverage-ignore-audit.ts`: the same check, reading
 * `coverage.exclude` from each `vitest.config.*` instead of
 * `coveragePathIgnorePatterns` from each `bunfig.toml`.
 *
 * The ignore list is the one part of the coverage setup that is judgement: a
 * file belongs in it only when the runner *cannot* execute it — generated
 * code, a thin process entrypoint (the `-bin.ts` convention), a type-only
 * module — never when it merely has not been executed. This audit is the
 * machine-checkable half. For every `vitest.config.*` in the tree it reads
 * `coverage.exclude`, expands each entry to the files it matches, and fails
 * when a matched file is neither on the allowlist of known-uninstrumentable
 * patterns (the `-bin.ts` convention, `generated/`, `tmp/`) nor free of
 * executable statements.
 *
 * "Free of executable statements" is a static scan, not the instrumenter: the
 * file is stripped of comments and string literals, its type-only declarations
 * (`import type`, `export type`, `interface`, `type`, `declare`) are removed,
 * and whatever is left is runtime code. A file the scan cannot classify is
 * reported as executable — the conservative direction, because an entry that
 * hides real code is the failure this gate exists to catch.
 *
 * Usage: node scripts/coverage-ignore-audit.mjs [--root <dir>]
 * Defaults: --root the process cwd.
 * Exit 0 when every entry is justified; exit 1 with a report otherwise.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

/** The patterns a file may match to be known-uninstrumentable. */
const ALLOWLIST = ["**/*-bin.ts", "**/generated/**", "**/tmp/**"];

/** The config files this audit reads. */
const CONFIG_FILE = /^vitest\.config\.[cm]?ts$/u;

function parseArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Every file under `dir`, relative to it, skipping `node_modules` and
// dot-directories (the installed skill itself lives in one).
function walk(dir, base, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, base, out);
    else if (entry.isFile()) out.push(relative(base, path));
  }
  return out;
}

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/gu;

// A glob as a regular expression over a `/`-separated relative path: `**/`
// matches zero or more directories, `**` matches across separators, `*` a run
// of non-separator characters, `?` one character.
function globToRegExp(pattern) {
  let out = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern.charAt(i);
    if (c === "*" && pattern.charAt(i + 1) === "*") {
      if (pattern.charAt(i + 2) === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(REGEX_SPECIAL, "\\$&");
  }
  return new RegExp(`${out}$`, "u");
}

// The index just past the quoted literal that starts at `start`.
function skipQuoted(source, start) {
  const quote = source.charAt(start);
  let i = start + 1;
  while (i < source.length) {
    const c = source.charAt(i);
    if (c === "\\") i += 2;
    else if (c === quote) return i + 1;
    else i += 1;
  }
  return source.length;
}

// The index just past the comment that starts at `start`.
function skipComment(source, start) {
  if (source.charAt(start + 1) === "/") {
    const end = source.indexOf("\n", start);
    return end < 0 ? source.length : end;
  }
  const end = source.indexOf("*/", start + 2);
  return end < 0 ? source.length : end + 2;
}

// Strip comments and string/template literals, so a `}` or `//` inside them
// cannot confuse the statement scan.
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source.charAt(i);
    const next = source.charAt(i + 1);
    if (c === "/" && (next === "/" || next === "*")) {
      i = skipComment(source, i);
    } else if (c === '"' || c === "'" || c === "`") {
      i = skipQuoted(source, i);
      out += " ";
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// The net brace depth change on one line.
function braceDelta(line) {
  let delta = 0;
  for (const c of line) {
    if (c === "{") delta += 1;
    else if (c === "}") delta -= 1;
  }
  return delta;
}

// `export { type A, type B } from "x"` / `import { type A } from "x"`: every
// specifier carries the `type` modifier, so TypeScript erases the statement.
function isTypeOnlyReExport(line) {
  const m = /^(?:export|import)\s*\{([^}]*)\}\s*from\b/u.exec(line);
  if (m === null) return false;
  const specifiers = (m[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return specifiers.length > 0 && specifiers.every((s) => s.startsWith("type "));
}

// Whether a line begins a type-only declaration: `import type`, `export type`,
// `interface`, `type`, `declare`, or an all-type re-export.
function isTypeOnlyStart(line) {
  if (/^(?:export\s+)?(?:interface|type|declare)\b/u.test(line)) return true;
  if (/^import\s+type\b/u.test(line)) return true;
  return isTypeOnlyReExport(line);
}

// Whether the source has any executable statement. A file whose every
// statement is a type-only declaration has none: TypeScript erases it to
// nothing, so the instrumenter sees an empty module.
function hasExecutableStatements(source) {
  const lines = stripCommentsAndStrings(source).split("\n");
  let inType = false;
  let depth = 0;
  for (const line of lines) {
    const text = line.trim();
    if (text === "") continue;
    if (inType) {
      depth += braceDelta(text);
      if (depth <= 0 && /[;}]\s*$/u.test(text)) inType = false;
      continue;
    }
    if (!isTypeOnlyStart(text)) return true;
    depth = braceDelta(text);
    inType = !(depth <= 0 && /[;}]\s*$/u.test(text));
  }
  return false;
}

// The string literals of the array that follows `key` in `text`, or null when
// the key is absent. The scan reads to the matching `]`.
function readArray(text, key) {
  const at = text.indexOf(key);
  if (at < 0) return null;
  const open = text.indexOf("[", at + key.length);
  const close = open < 0 ? -1 : text.indexOf("]", open);
  if (open < 0 || close < 0) return null;
  const body = text.slice(open + 1, close);
  const out = [];
  const re = /"([^"]*)"/gu;
  let m = re.exec(body);
  while (m !== null) {
    out.push(m[1] ?? "");
    m = re.exec(body);
  }
  return out;
}

// The `coverage.exclude` entries of one config, or an empty list when the
// config declares none.
function readExclude(text) {
  const coverageAt = text.indexOf("coverage");
  return coverageAt < 0 ? [] : (readArray(text.slice(coverageAt), "exclude") ?? []);
}

// The findings one config's ignore entries produce, over the files beside it.
function auditConfig(config, files) {
  const entries = readExclude(readFileSync(config, "utf8"));
  const findings = [];
  for (const entry of entries) {
    const re = globToRegExp(entry);
    for (const file of files) {
      if (!re.test(file)) continue;
      if (ALLOWLIST.some((pattern) => globToRegExp(pattern).test(file))) continue;
      if (hasExecutableStatements(readFileSync(join(dirname(config), file), "utf8"))) {
        findings.push({ config, entry, file });
      }
    }
  }
  return findings;
}

const root = resolve(parseArg("--root") ?? ".");
const configs = walk(root, root, []).filter((f) => CONFIG_FILE.test(basename(f)));

if (configs.length === 0) {
  console.log("coverage-ignore-audit: no vitest.config.* found — nothing to audit");
  process.exit(0);
}

const findings = [];
for (const config of configs) {
  const dir = dirname(join(root, config));
  findings.push(...auditConfig(join(root, config), walk(dir, dir, [])));
}

if (findings.length > 0) {
  console.error(`\n${findings.length} coverage ignore entry(ies) hide executable code:\n`);
  for (const f of findings) {
    console.error(`  ${f.config}: "${f.entry}" matches ${f.file}, which has executable statements`);
  }
  console.error(
    "\nRemove the entry, or move the code it hides into a covered file. A file belongs in the ignore list only when the runner cannot execute it.",
  );
  process.exit(1);
}

console.log(
  `coverage-ignore-audit: PASS — ${configs.length} config(s), every ignore entry justified`,
);
