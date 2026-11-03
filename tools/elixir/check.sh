#!/bin/sh
# Runs what CI's Elixir jobs run, in every Mix package: deps, format,
# a warnings-as-errors compile and the tests (docs/agents/checks.md).
# Skips with a note when Mix isn't installed, so a Bun-only machine can
# still run `bun run check`; CI runs these jobs either way.
set -e
command -v mix >/dev/null 2>&1 || { echo 'check:elixir: mix not found, skipping (CI still runs it)' >&2; exit 0; }
root=$(cd "$(dirname "$0")/../.." && pwd)
for dir in "$root"/packages/*/; do
  [ -f "$dir/mix.exs" ] || continue
  name=$(basename "$dir")
  echo "== $name" >&2
  (
    cd "$dir"
    mix deps.get >/dev/null
    mix format --check-formatted
    mix compile --warnings-as-errors >/dev/null
    mix test
  )
done
