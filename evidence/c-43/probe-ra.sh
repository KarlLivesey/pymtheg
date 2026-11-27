#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-43: what rust-analyzer reports on the toolchain fixture, cleanly and
# with a failing build script, offline with an empty crate cache.
# Usage: probe-ra.sh FIXTURE NAME (under $PYM_SCRATCH)
set -uo pipefail
fixture="$(realpath "$1")"; scratch="$PYM_SCRATCH/$2"
mkdir -p "$scratch"
echo "rust-analyzer: $(rust-analyzer --version)"
echo "rustc: $(rustc -V)"
echo "cargo: $(cargo -V)"
echo "sysroot: $(rustc --print sysroot | sed 's#.*/toolchains/#<toolchains>/#')"
for variant in clean failing; do
  dir="$scratch/$variant"
  cp -a "$fixture" "$dir"
  if [ "$variant" = failing ]; then
    printf '%s\n' 'fn main() { panic!("missing system library") }' > "$dir/app/build.rs"
  fi
  export CARGO_HOME="$scratch/cargo-home-$variant"
  export CARGO_TARGET_DIR="$scratch/target-$variant"
  export CARGO_NET_OFFLINE=true
  mkdir -p "$CARGO_HOME"
  (cd "$dir" && rust-analyzer scip . --output "$scratch/$variant.scip" > "$scratch/$variant.out" 2> "$scratch/$variant.err"; echo "exit $?")
  echo "--- $variant: scip bytes $(stat -c %s "$scratch/$variant.scip" 2>/dev/null)"
  grep -v -i 'progress' "$scratch/$variant.err" | head -40
  echo "--- stdout"
  head -20 "$scratch/$variant.out"
done
