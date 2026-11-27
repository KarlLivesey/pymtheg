#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-43: fill a crate cache for the measurement, as a developer who has built
# each project would have one. The dev server's default crate cache has
# index folders owned by root (left by an earlier root-run cargo), so cargo
# cannot cache index entries there and offline resolution fails; the
# measurement uses its own CARGO_HOME in scratch and never touches those
# folders. On a throwaway copy of each pin (a pin without a Cargo.lock would
# get one written; nothing in the pin changes): cargo fetch, then online
# cargo metadata (it caches index entries fetch may not), then offline cargo
# metadata to check the route will resolve.
# Usage: CARGO_HOME=<scratch cache> fetch-crates.sh PINS_DIR NAME...
set -uo pipefail
pins="$1"; shift
: "${CARGO_HOME:?set CARGO_HOME to a crate cache for the measurement}"
mkdir -p "$CARGO_HOME"
for name in "$@"; do
  copy="$PYM_SCRATCH/fetch-copy/$name"
  rm -rf "$copy"; mkdir -p "$copy"
  cp -a "$pins/$name/." "$copy/"
  (cd "$copy" && cargo fetch --quiet > "$PYM_SCRATCH/fetch-$name.log" 2>&1; f=$?
    cargo metadata --format-version 1 > /dev/null 2>> "$PYM_SCRATCH/fetch-$name.log"; m=$?
    cargo metadata --format-version 1 --offline > /dev/null 2>> "$PYM_SCRATCH/fetch-$name.log"
    echo "$name: fetch $f, metadata $m, offline metadata $? (lockfile tracked: $(git -C "$pins/$name" ls-files Cargo.lock | wc -l))")
  rm -rf "$copy"
done
