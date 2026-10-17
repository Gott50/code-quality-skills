#!/bin/sh
# dep-graph — dependency-cruiser over the workspace: no cycles, no deep imports.
#
# The gate is the tool's own verdict plus one guard. dependency-cruiser ships no
# transpiler of its own: it parses TypeScript only when the TypeScript compiler
# is installed beside it, and it exits 0 on a graph it cruised nothing into. A
# repo whose .ts files never entered the graph would therefore report green
# forever, so the gate checks the graph actually holds the repo's TypeScript
# before it trusts the verdict.
#
# The tool is a devDependency, so the script runs the local binary directly and
# needs no package manager: the same command works under bun, npm and pnpm.
#
# Usage: sh scripts/dep-graph.sh
# Exit codes: 0 clean, 1 violations or a graph without the repo's TypeScript,
# 2 the tool is missing.
set -eu

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

bin=node_modules/.bin/depcruise
if [ ! -x "$bin" ]; then
  echo "dep-graph: $bin not found — run the project's install first" >&2
  exit 2
fi

# `--ignore-known` needs the file to exist, so it is passed only when the repo
# has recorded its known violations. Without it the gate is the plain wall.
known=.dependency-cruiser-known-violations.json
if [ -f "$known" ]; then
  set -- --ignore-known "$known"
else
  set --
fi

# The first TypeScript source in the repo, if there is one. The guard below
# compares it against the graph: a repo with TypeScript sources and a graph
# without them has a missing parser, not a clean dependency graph.
ts_source=$(find . -name node_modules -prune -o -name '*.ts' -print 2>/dev/null | head -n 1)

# The JSON report is the one output that carries both the violations and the
# module list, so the guard and the verdict come from a single run.
report=$("$bin" --config .dependency-cruiser.cjs --output-type json "$@" .) || true

printf '%s' "$report" | TS_SOURCE="$ts_source" node -e '
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  const report = JSON.parse(raw);
  const { totalCruised, error, warn, violations } = report.summary;
  for (const v of violations) {
    console.log(`${v.rule.severity} ${v.rule.name}: ${v.from} -> ${v.to}`);
  }
  const tsSource = process.env.TS_SOURCE;
  const cruisedTs = report.modules.some((m) => /\.(ts|tsx|mts|cts)$/.test(m.source));
  if (totalCruised === 0 || (tsSource && !cruisedTs)) {
    console.error(`dep-graph: ${tsSource} is in the repo but not in the graph — is typescript installed?`);
    process.exit(1);
  }
  console.log(`${totalCruised} modules cruised, ${error} error(s), ${warn} warning(s)`);
  process.exit(error > 0 ? 1 : 0);
});
'
