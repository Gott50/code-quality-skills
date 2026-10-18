#!/bin/sh
# license-check — the license allowlist wall.
#
# Every installed dependency's license must be on the allowlist below. The tool
# is a devDependency, so the script runs the local binary directly and needs no
# package manager: the same command works under bun, npm and pnpm.
#
# Usage: sh scripts/license-check.sh
# Exit codes: 0 every license allowed, 1 a license outside the allowlist,
# 2 the tool is missing.
set -eu

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

bin=node_modules/.bin/license-checker
if [ ! -x "$bin" ]; then
  echo "license-check: $bin not found — run the project's install first" >&2
  exit 2
fi

# The allowlist. Extend it deliberately: a new license is a policy decision, not
# a fix for a red gate. The tool matches the license string it reports, so a
# dual-licensed package ("(MIT OR Apache-2.0)") and a package with no license
# field at all ("UNKNOWN") both fail until they are named here.
#
# `CC-BY-3.0` and `(MIT AND CC-BY-3.0)` are here because license-checker's own
# SPDX data packages (spdx-exceptions, spdx-ranges) carry them, and the scan
# covers devDependencies as well as dependencies. Both are permissive —
# attribution only, no copyleft — so they are allowed rather than excluded.
ALLOW="MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause;0BSD;Unlicense;CC0-1.0;Python-2.0;CC-BY-3.0;(MIT AND CC-BY-3.0)"

# `--excludePrivatePackages` keeps the repo's own package out of the scan: its
# license is the repo's, not a dependency's, and a private package usually
# declares none.
exec "$bin" --excludePrivatePackages --onlyAllow "$ALLOW" "$@"
