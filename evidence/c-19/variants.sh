#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: joins and comparisons for the variant runs.
#   - axum: default against build scripts and proc macros configured off,
#     cfg(test) off and all features, compared as normalised SCIP payload
#     (scip-compare.mjs: documents by relative path, metadata left out) and
#     as join results; all features, and all features plus the examples/
#     workspace, joined for coverage
#   - ripgrep offline with an empty crate cache, joined
# Usage: variants.sh WORK OUT_DIR
set -uo pipefail
work="$1"; outdir="$2"
here="$(dirname "$0")"
sysroot="$(rustc --print sysroot)"
O="$work/out"
graph() { if [ -f "$work/${PYMDIR:-pym}/$1-2.index.json" ]; then echo "$work/${PYMDIR:-pym}/$1-2/.pymtheg/rebuildable/graph.sqlite"; else echo "$work/${PYMDIR:-pym}/$1/.pymtheg/rebuildable/graph.sqlite"; fi; }
join() { # NAME SCIP-SPEC OUT PIN CARGO_HOME
  node --max-old-space-size=16000 "$here/join.mjs" --graph "$(graph "$4")" --scip "$2" --root "$work/src/$4" --name "$1" \
    --cargo-home "$5" --sysroot "$sysroot" --out "$3" > /dev/null
}
node "$here/scip-compare.mjs" "$O/axum.default.scip" "$O/axum.nobuild.scip" "$O/axum.notest.scip" "$O/axum.allfeatures.scip" > "$outdir/axum-scip-compare.json"
join axum-nobuild "$O/axum.nobuild.scip" "$O/axum.nobuild.join.json" axum "$work/cargo-default-axum"
join axum-notest "$O/axum.notest.scip" "$O/axum.notest.join.json" axum "$work/cargo-default-axum"
join axum-allfeatures "$O/axum.allfeatures.scip" "$O/axum.allfeatures.join.json" axum "$work/cargo-allfeatures-axum"
join axum-allfeatures+examples "$O/axum.allfeatures.scip,$O/axum.examples.scip=examples" "$O/axum.allfeatures-examples.join.json" axum "$work/cargo-allfeatures-axum"
join ripgrep-offline-empty "$O/ripgrep.offline.scip" "$O/ripgrep.offline.join.json" ripgrep "$work/cargo-default-ripgrep"
# join results: the default join against the configured-off joins, without the pin name
node -e '
const fs = require("fs");
const strip = (f) => { const r = JSON.parse(fs.readFileSync(f, "utf8")); delete r.pin; return JSON.stringify(r); };
const base = strip(process.argv[1]);
const out = {};
for (const f of process.argv.slice(2)) out[f.split("/").pop()] = strip(f) === base;
console.log(JSON.stringify({ base: process.argv[1].split("/").pop(), identicalJoinResults: out }));
' "$O/axum.default.join.json" "$O/axum.nobuild.join.json" "$O/axum.notest.join.json" > "$outdir/axum-join-compare.json"
cat "$outdir/axum-scip-compare.json" "$outdir/axum-join-compare.json"
