#!/usr/bin/env bash
# C-6 cold-time split. Run from the mirrored tree root on the dev server.
#   bash evidence/c-6/split.sh <dist> <out.jsonl> <corpus> <variant>...
# <corpus>: restic | vector (pinned server corpora) or a sweep id fetched by
# fetch.sh (cli/cli, ...). Each variant is one cold index of a fresh copy on
# the scratch disk, serially.
set -euo pipefail
tree=$(pwd); dist=$(realpath "$1"); out="$2"; corpus="$3"; shift 3
mkdir -p "$(dirname "$out")"
S=${PYM_SCRATCH:?}
case "$corpus" in
  restic|vector) src=~/pymtheg-dev/corpora/$corpus ;;
  *) src="$S/src/$corpus" ;;
esac
for variant in "$@"; do
  w="$S/work/${corpus//\//_}"
  chmod -R u+w "$w" 2>/dev/null || true
  rm -rf "$w"; mkdir -p "$(dirname "$w")"
  cp -a --reflink=auto "$src" "$w"; chmod -R u+w "$w"; rm -f "$w/.done"
  node "$tree/evidence/c-6/measure.mjs" "$dist" "$w" "$corpus" "$variant" >> "$out"
  tail -1 "$out" | cut -c1-400
done
