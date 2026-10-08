#!/usr/bin/env bash
# THROWAWAY. Regenerates prototype/transcript.txt for wayfinder ticket #7
# ("The detector script and its applicability matrix"). Run from the repo root:
#
#   bash prototype/transcript.sh > prototype/transcript.txt
#
# Needs node >= 22. The collision case is a scratch copy of the bun-ts fixture with prettier added,
# because no committed fixture can reach the collision path while the only formatter recipe is
# Bun-gated and the npm/pnpm variants have not landed yet.
set -u

SKILL=skills/code-quality-setup
FIXTURES=fixtures
SCRATCH=/tmp/cqs-detect-collide

run() {
  echo
  echo "\$ $*"
  "$@"
}

echo "# detect.mjs — prototype transcript (wayfinder ticket #7)"
echo
echo "node $(node --version) on $(uname -s)"
echo
echo "## 1. The three fixtures"
for f in plain-ts bun-ts pnpm-workspace; do
  echo
  echo "### fixtures/$f"
  run node "$SKILL/scripts/detect.mjs" "$FIXTURES/$f"
done

echo
echo "## 2. The collision path (scratch: bun-ts + prettier)"
rm -rf "$SCRATCH"
cp -R "$FIXTURES/bun-ts" "$SCRATCH"
node -e '
  const fs = require("node:fs");
  const p = process.argv[1] + "/package.json";
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  m.devDependencies.prettier = "3.6.2";
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  fs.writeFileSync(process.argv[1] + "/.prettierrc", JSON.stringify({ semi: true }, null, 2) + "\n");
' "$SCRATCH"
run node "$SKILL/scripts/detect.mjs" "$SCRATCH" --compact

echo
echo "## 3. A real repo (omp-factory: Bun workspace, biome + oxlint + stryker + husky + CI)"
run node "$SKILL/scripts/detect.mjs" /Users/timomorawitz/Documents/omp-factory --compact

echo
echo "## 4. A directory with no package.json (this repo's root)"
run node "$SKILL/scripts/detect.mjs" . --compact

echo
echo "## 5. A malformed recipe is reported, not fatal"
SKILLCOPY=/tmp/cqs-detect-skill
rm -rf "$SKILLCOPY"
cp -R "$SKILL" "$SKILLCOPY"
cat > "$SKILLCOPY/references/recipes/broken.md" <<'EOF'
---
id: broken
title: A recipe with no Undo section
when:
  language: [typescript]
---

## Apply

Nothing.
EOF
run node "$SKILLCOPY/scripts/detect.mjs" "$FIXTURES/bun-ts"

echo
echo "## 6. Hard errors"
run node "$SKILL/scripts/detect.mjs" /nonexistent
