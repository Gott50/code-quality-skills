#!/bin/sh
# semgrep — the pattern-level security scan: injection and unsafe APIs.
#
# semgrep is a Python tool with no static binary release, so the launcher runs a
# pinned version through a runner the machine already has, without installing
# anything into the project: uvx, then pipx, then a semgrep already on PATH. The
# ruleset is vendored at .semgrep/rules.yml, so the scan is reproducible and runs
# offline once the tool is cached.
#
# Credential detection is not this scan's job: the secret-scan recipe owns it.
#
# Usage: sh scripts/semgrep.sh [paths...]   (default: the whole repo)
# Exit codes: 0 clean, 1 findings, 2 no runner or no ruleset.
set -eu

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

SEMGREP_VERSION=1.181.0
config=.semgrep/rules.yml

if [ ! -f "$config" ]; then
  echo "semgrep: $config not found" >&2
  exit 2
fi

if command -v uvx >/dev/null 2>&1; then
  exec uvx --from "semgrep==$SEMGREP_VERSION" semgrep scan --config "$config" --error --metrics=off --quiet "$@"
fi

if command -v pipx >/dev/null 2>&1; then
  exec pipx run --spec "semgrep==$SEMGREP_VERSION" semgrep scan --config "$config" --error --metrics=off --quiet "$@"
fi

if command -v semgrep >/dev/null 2>&1; then
  exec semgrep scan --config "$config" --error --metrics=off --quiet "$@"
fi

echo "semgrep: no runner found — install uv (https://docs.astral.sh/uv/) or pipx, or semgrep itself" >&2
exit 2
