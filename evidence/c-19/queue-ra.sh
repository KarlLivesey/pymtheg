#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: rust-analyzer runs, one at a time: the axum variants (build scripts and
# proc macros off; all features; the separate examples/ workspace), the
# one-file-edit re-runs, then the default run of every remaining pin.
# Usage: queue-ra.sh WORK
set -uo pipefail
work="$1"
here="$(dirname "$0")"
off='{"cargo":{"buildScripts":{"enable":false}},"procMacro":{"enable":false}}'
allf='{"cargo":{"features":"all"}}'
[ -f "$work/out/axum.nobuild.meta.txt" ] || { echo "== axum nobuild"; bash "$here/ra-scip.sh" "$work" axum nobuild "$off" "$work/cargo-default-axum"; }
[ -f "$work/out/axum.allfeatures.meta.txt" ] || { echo "== axum allfeatures"; bash "$here/ra-scip.sh" "$work" axum allfeatures "$allf"; }
[ -f "$work/out/axum.examples.meta.txt" ] || { echo "== axum examples"; bash "$here/ra-scip.sh" "$work" axum examples "" "" examples; }
[ -f "$work/out/ripgrep.rerun.scip" ] || { echo "== ripgrep rerun"; bash "$here/ra-rerun.sh" "$work" ripgrep crates/core/main.rs; }
[ -f "$work/out/helix.rerun.scip" ] || { echo "== helix rerun"; bash "$here/ra-rerun.sh" "$work" helix helix-core/src/lib.rs; }
while [ ! -f "$work/fetched.done" ]; do sleep 5; done
while read -r name url sha; do
  [ -f "$work/out/$name.default.meta.txt" ] && continue
  echo "== $name default"
  bash "$here/ra-scip.sh" "$work" "$name" default
done < "$work/pins.txt"
