#!/bin/sh
# Validate a commit message against commitlint.config.mjs.
#
# The message file is an explicit argument, never an implicit default: the
# commit-msg hook passes the path git hands it ($1), and the gate passes a file
# the caller wrote. Reading .git/COMMIT_EDITMSG implicitly would make the gate
# depend on the repo's own state — on a fresh clone with one commit that file
# holds whatever was last committed, so the gate would pass or fail for a reason
# unrelated to the change under test.
set -eu

message_file="${1:-}"
if [ -z "$message_file" ]; then
  echo "usage: sh scripts/commit-msg.sh <message-file>" >&2
  exit 2
fi
if [ ! -f "$message_file" ]; then
  echo "commit-msg: no such message file: $message_file" >&2
  exit 2
fi

# The runner is the package manager's, so the linter resolves the project's own
# node_modules/.bin. The npm/pnpm variant of this recipe swaps bunx for npx.
bunx commitlint --edit "$message_file"
