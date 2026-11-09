#!/bin/sh
# Runs what CI's Elixir jobs run, in every Mix package: deps, format,
# a warnings-as-errors compile and the tests (docs/agents/checks.md).
# Skips with a note when Mix isn't installed, so a Bun-only machine can
# still run `bun run check`; CI runs these jobs either way. CHECK_ELIXIR_SKIP
# skips it too, for CI's Bun job, whose image has Mix.
set -e
[ -z "$CHECK_ELIXIR_SKIP" ] || { echo 'check:elixir: CHECK_ELIXIR_SKIP is set, skipping' >&2; exit 0; }
command -v mix >/dev/null 2>&1 || { echo 'check:elixir: mix not found, skipping (CI still runs it)' >&2; exit 0; }
root=$(cd "$(dirname "$0")/../.." && pwd)
sh "$root/tools/elixir/deps.sh"
for dir in "$root"/packages/*/; do
  [ -f "$dir/mix.exs" ] || continue
  name=$(basename "$dir")
  echo "== $name" >&2
  (
    cd "$dir"
    mix format --check-formatted
    mix compile --warnings-as-errors >/dev/null
    mix test
  )
done
