#!/bin/sh
# Fetches the deps of every Mix package (docs/agents/checks.md). The first
# fetch of the north_talk git dep in a fresh worktree can fail on
# `git remote add origin`; a second fetch succeeds, so each package retries once.
set -e
command -v mix >/dev/null 2>&1 || { echo 'deps: mix not found, skipping' >&2; exit 0; }
root=$(cd "$(dirname "$0")/../.." && pwd)
for dir in "$root"/packages/*/; do
  [ -f "$dir/mix.exs" ] || continue
  echo "== deps $(basename "$dir")" >&2
  (cd "$dir" && { mix deps.get >/dev/null 2>&1 || mix deps.get >/dev/null; })
done
