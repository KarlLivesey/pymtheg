#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-43: download each pin's crates into the user's crate cache, as a
# developer who has built the project would have, so the offline route can
# resolve them. cargo fetch runs on a throwaway copy: a pin without a
# Cargo.lock would get one written. Nothing in the pin changes.
# Usage: fetch-crates.sh PINS_DIR NAME...
set -uo pipefail
pins="$1"; shift
for name in "$@"; do
  copy="$PYM_SCRATCH/fetch-copy/$name"
  mkdir -p "$copy"
  cp -a "$pins/$name/." "$copy/"
  (cd "$copy" && cargo fetch --quiet > "$PYM_SCRATCH/fetch-$name.log" 2>&1; echo "$name: cargo fetch exit $? (lockfile tracked: $(git -C "$pins/$name" ls-files Cargo.lock | wc -l))")
  rm -rf "$copy"
done
