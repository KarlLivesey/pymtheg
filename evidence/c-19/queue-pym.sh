#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: fetch every finished Rust pin, then index each with this build
# (source-only, default settings). Skips pins already fetched or indexed.
# Usage: queue-pym.sh BUILD WORK
set -uo pipefail
build="$1"; work="$2"
here="$(dirname "$0")"
node "$here/pins.mjs" > "$work/pins.txt"
while read -r name url sha; do
  [ -d "$work/src/$name" ] || bash "$here/fetch.sh" "$work" "$name" "$url" "$sha"
done < "$work/pins.txt"
touch "$work/fetched.done"
while read -r name url sha; do
  [ -d "$work/pym/$name" ] && continue
  echo "== $name"
  bash "$here/pym-index.sh" "$build" "$work" "$name"
done < "$work/pins.txt"
