// THROWAWAY — builds the shareable demo.
//
// A page opened with file:// cannot `import` a sibling module, so the demo is ONE self-contained
// file: the logic module is inlined into the shell. `manifest.mjs` stays the primary source; this
// script only strips the top-level `export ` keywords so the declarations land in the page's script
// scope, and drops the result into the shell's placeholder line.
//
// Run: node prototype/build-demo.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = join(here, "manifest.mjs");
const shellPath = join(here, "demo-shell.html");
const outPath = join(here, "manifest-demo.html");
const PLACEHOLDER = "/*__MANIFEST_MODULE__*/";

const moduleSource = readFileSync(modulePath, "utf8");
const inlined = moduleSource.replace(/^export (?=(?:const|let|var|function|class)\b)/gm, "");

if (/^\s*(?:import|export)\b/m.test(inlined)) {
  throw new Error("manifest.mjs still has a top-level import/export after stripping");
}

const shell = readFileSync(shellPath, "utf8");
if (!shell.includes(PLACEHOLDER)) {
  throw new Error(`demo-shell.html has no ${PLACEHOLDER} placeholder`);
}

const out = shell.replace(PLACEHOLDER, inlined.trimEnd());
if (/^\s*(?:import|export)\b/m.test(out)) {
  throw new Error("the built page still has a top-level import/export statement");
}

writeFileSync(outPath, out);
console.log(
  `manifest-demo.html: ${out.length} bytes (module ${moduleSource.length} bytes inlined, ` +
    `${out.split("\n").length} lines)`,
);
