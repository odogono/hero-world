#!/bin/sh
# Turns a generated draft into a place's Picture (ADR 0027): real pixel art
# at 480×192, with its own palette of at most 256 colours and no dithering,
# as a VGA screen had, saved as an 8-bit PNG with no metadata. This is the
# only way a Picture enters the repo; see packages/mua_world/docs/pictures.md.
#
#   tools/pictures/reduce.sh <draft.png> <place_id>
#
# writes packages/mua_world/priv/edl/pictures/<place_id>.png. Needs
# ImageMagick 7 (`magick`).
set -e
[ $# -eq 2 ] || { echo 'usage: tools/pictures/reduce.sh <draft.png> <place_id>' >&2; exit 2; }
command -v magick >/dev/null 2>&1 || { echo 'reduce: needs ImageMagick 7 (magick)' >&2; exit 1; }
case "$2" in
  *[!a-z0-9_]* | '') echo "reduce: <place_id> must be the place's Definition name, such as harbour_steps" >&2; exit 2 ;;
esac
root=$(cd "$(dirname "$0")/../.." && pwd)
out="$root/packages/mua_world/priv/edl/pictures/$2.png"
magick "$1" -resize '480x192!' +dither -colors 256 -strip "png8:$out"
echo "$out"
