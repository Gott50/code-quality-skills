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
echo "## 6. Every \`when\` branch, exercised"
echo
echo "The two real recipes only reach language / packageManager / { file } / { recipe: \"*\" }."
echo "These scratch recipes reach the other five branches, plus both halves of the selection"
echo "fixpoint (the grow pass and the shrink pass). Output is filtered to the probe recipes."
PROBESKILL=/tmp/cqs-detect-probes
rm -rf "$PROBESKILL"
cp -R "$SKILL" "$PROBESKILL"
write_probe() {
  cat > "$PROBESKILL/references/recipes/$1.md"
}
write_probe probe-dep-script <<'EOF'
---
id: probe-dep-script
title: Probe — { dep } and { script }
when:
  requires: [{ dep: typescript }, { script: build }]
---

## Apply

Nothing.

## Idempotency

Nothing.

## Undo

- Nothing.
EOF
write_probe probe-workspace-single <<'EOF'
---
id: probe-workspace-single
title: Probe — when.workspace single
when:
  workspace: single
---

## Apply

Nothing.

## Idempotency

Nothing.

## Undo

- Nothing.
EOF
write_probe probe-workspace-ws <<'EOF'
---
id: probe-workspace-ws
title: Probe — when.workspace workspace
when:
  workspace: workspace
---

## Apply

Nothing.

## Idempotency

Nothing.

## Undo

- Nothing.
EOF
write_probe probe-excludes <<'EOF'
---
id: probe-excludes
title: Probe — when.excludes
when:
  excludes: [{ file: bun.lock }]
---

## Apply

Nothing.

## Idempotency

Nothing.

## Undo

- Nothing.
EOF
write_probe probe-recipe-id <<'EOF'
---
id: probe-recipe-id
title: Probe — { recipe: <id> }, a specific recipe
when:
  requires: [{ recipe: biome-assist }]
---

## Apply

Nothing.

## Idempotency

Nothing.

## Undo

- Nothing.
EOF
write_probe probe-conflict-a <<'EOF'
---
id: probe-conflict-a
title: Probe — conflicts.recipes, higher priority
priority: 10
conflicts:
  recipes: [probe-conflict-b]
---

## Apply

Nothing.

## Idempotency

Nothing.

## Undo

- Nothing.
EOF
write_probe probe-conflict-b <<'EOF'
---
id: probe-conflict-b
title: Probe — conflicts.recipes, lower priority
priority: 5
conflicts:
  recipes: [probe-conflict-a]
---

## Apply

Nothing.

## Idempotency

Nothing.

## Undo

- Nothing.
EOF
write_probe probe-orphan <<'EOF'
---
id: probe-orphan
title: Probe — requires a recipe that the shrink pass then drops
when:
  requires: [{ recipe: probe-conflict-b }]
---

## Apply

Nothing.

## Idempotency

Nothing.

## Undo

- Nothing.
EOF
for f in plain-ts bun-ts pnpm-workspace; do
  echo
  echo "### fixtures/$f"
  echo "\$ node <probe skill>/scripts/detect.mjs $FIXTURES/$f --compact | jq '{probes, heldBack}'"
  node "$PROBESKILL/scripts/detect.mjs" "$FIXTURES/$f" --compact | jq -c '{
    probes: [.recipes[] | select(.id | startswith("probe-")) | {id, applicable, selected, why: [.reasons[] | select(.pass == false) | .detail]}],
    heldBack
  }'
done

echo
echo "## 7. Hard errors"
run node "$SKILL/scripts/detect.mjs" /nonexistent
