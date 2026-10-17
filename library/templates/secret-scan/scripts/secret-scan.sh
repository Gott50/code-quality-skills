#!/bin/sh
# secret-scan — run the pinned gitleaks binary over the staged diff or the history.
#
# gitleaks is not a dependency of the project. The hook must work on a fresh clone with no
# install step, and this recipe serves Bun, npm and pnpm alike, so it cannot assume a package
# manager's runner; a binary on PATH is a property of the machine, not of the repo, so the hook
# would work on one developer's laptop and not in CI. The pinned release is therefore fetched
# once, checksum-verified, and cached outside the repo, at
# ${XDG_CACHE_HOME:-$HOME/.cache}/code-quality/gitleaks/<version>.
#
# Usage:
#   sh scripts/secret-scan.sh --install   fetch the pinned binary, scan nothing
#   sh scripts/secret-scan.sh --staged    scan the staged diff (the pre-commit hook, the gate)
#   sh scripts/secret-scan.sh --history   scan every commit (a manual sweep of the past)
#
# Exit codes: 0 clean, 1 findings or a failed fetch, 2 usage.
set -eu

GITLEAKS_VERSION=8.30.1

usage() {
  echo "usage: sh scripts/secret-scan.sh --install|--staged|--history" >&2
  exit 2
}

[ "$#" -eq 1 ] || usage

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *)
    echo "secret-scan: unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *)
    echo "secret-scan: unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

# sha256 of the pinned release asset, from gitleaks_${GITLEAKS_VERSION}_checksums.txt.
case "$os-$arch" in
  darwin-arm64) sha256=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  darwin-x64) sha256=dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709 ;;
  linux-arm64) sha256=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
  linux-x64) sha256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  *)
    echo "secret-scan: no pinned gitleaks build for $os-$arch" >&2
    exit 1
    ;;
esac

cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/code-quality/gitleaks/$GITLEAKS_VERSION"
gitleaks="$cache_dir/gitleaks"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    echo "secret-scan: neither sha256sum nor shasum is on PATH" >&2
    return 1
  fi
}

if [ ! -x "$gitleaks" ]; then
  command -v curl >/dev/null 2>&1 || {
    echo "secret-scan: curl is required to fetch the pinned gitleaks binary" >&2
    exit 1
  }
  asset="gitleaks_${GITLEAKS_VERSION}_${os}_${arch}.tar.gz"
  url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${asset}"
  echo "secret-scan: fetching gitleaks $GITLEAKS_VERSION ($os-$arch)" >&2
  mkdir -p "$cache_dir"
  curl -fsSL "$url" -o "$cache_dir/$asset" || {
    echo "secret-scan: could not download $url" >&2
    exit 1
  }
  got=$(sha256_of "$cache_dir/$asset") || exit 1
  if [ "$got" != "$sha256" ]; then
    echo "secret-scan: checksum mismatch for $asset" >&2
    echo "  want $sha256" >&2
    echo "  got  $got" >&2
    rm -f "$cache_dir/$asset"
    exit 1
  fi
  tar -xzf "$cache_dir/$asset" -C "$cache_dir" gitleaks || exit 1
  rm -f "$cache_dir/$asset"
  chmod +x "$gitleaks"
fi

case "$1" in
  --install) exit 0 ;;
  --staged) scan=--staged ;;
  --history) scan= ;;
  *) usage ;;
esac

# The hook runs at the repo root; a manual run may not.
cd "$(git rev-parse --show-toplevel)" || exit 1
# `$scan` is empty for --history and must vanish as a word, so it stays unquoted.
exec "$gitleaks" git $scan --redact --no-banner
