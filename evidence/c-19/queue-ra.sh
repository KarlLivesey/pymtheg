#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: rust-analyzer runs, one at a time: the default run of every pin, then
# the axum variants (build scripts and proc macros "off"; cfg(test) off; all
# features; the separate examples/ workspace), the one-file-edit re-runs and
# the ripgrep extras (lsif, offline with an empty crate cache).
# Usage: queue-ra.sh WORK
set -uo pipefail
work="$1"
here="$(dirname "$0")"
while [ ! -f "$work/fetched.done" ]; do sleep 5; done
while read -r name url sha; do
  grep -q "^scip-bytes: [1-9]" "$work/out/$name.default.meta.txt" 2>/dev/null && continue
  echo "== $name default"
  bash "$here/ra-scip.sh" "$work" "$name" default
done < "$work/pins.txt"
off='{"cargo":{"buildScripts":{"enable":false}},"procMacro":{"enable":false}}'
notest='{"cfg":{"setTest":false}}'
allf='{"cargo":{"features":"all"}}'
grep -q "^scip-bytes: [1-9]" "$work/out/axum.nobuild.meta.txt" 2>/dev/null || { echo "== axum nobuild"; bash "$here/ra-scip.sh" "$work" axum nobuild "$off" "$work/cargo-default-axum"; }
grep -q "^scip-bytes: [1-9]" "$work/out/axum.notest.meta.txt" 2>/dev/null || { echo "== axum notest"; bash "$here/ra-scip.sh" "$work" axum notest "$notest" "$work/cargo-default-axum"; }
grep -q "^scip-bytes: [1-9]" "$work/out/axum.allfeatures.meta.txt" 2>/dev/null || { echo "== axum allfeatures"; bash "$here/ra-scip.sh" "$work" axum allfeatures "$allf"; }
grep -q "^scip-bytes: [1-9]" "$work/out/axum.examples.meta.txt" 2>/dev/null || { echo "== axum examples"; bash "$here/ra-scip.sh" "$work" axum examples "" "" examples; }
[ -s "$work/out/ripgrep.rerun.scip" ] || { echo "== ripgrep rerun"; bash "$here/ra-rerun.sh" "$work" ripgrep crates/core/main.rs; }
[ -s "$work/out/helix.rerun.scip" ] || { echo "== helix rerun"; bash "$here/ra-rerun.sh" "$work" helix helix-core/src/lib.rs; }
[ -s "$work/out/ripgrep.offline.scip" ] || { echo "== ripgrep extras"; bash "$here/ra-extra.sh" "$work"; }
echo "== queue done"
