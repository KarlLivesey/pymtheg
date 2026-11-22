#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-43: run rust-analyzer on a copy of a pin, offline, and show what its
# build-script step left for one package: the target directory's build
# folders and any stderr a build script wrote.
# Usage: probe-build.sh PIN_DIR NAME PACKAGE
set -uo pipefail
pin="$1"; name="$2"; package="$3"
dir="$PYM_SCRATCH/probe-build/$name"
mkdir -p "$dir"
cp -a "$pin/." "$dir/copy/"
export CARGO_TARGET_DIR="$dir/target" CARGO_NET_OFFLINE=true
(cd "$dir/copy" && rust-analyzer scip . --output "$dir/index.scip" > "$dir/out.txt" 2> "$dir/err.txt"; echo "exit $?")
ls -d "$CARGO_TARGET_DIR"/debug/build/"$package"-* 2>/dev/null
for d in "$CARGO_TARGET_DIR"/debug/build/"$package"-*; do ls "$d"; [ -f "$d/stderr" ] && head -5 "$d/stderr"; done
grep -c "build script" "$dir/err.txt"
grep -i "$package" "$dir/err.txt" | head -5
cargo metadata --format-version 1 --offline --manifest-path "$dir/copy/Cargo.toml" --filter-platform x86_64-unknown-linux-gnu 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);const p=m.packages.filter(p=>p.name===process.argv[1]);
for(const x of p){console.log(x.id, x.targets.map(t=>t.kind.join("+")).join(","));const n=m.resolve.nodes.find(n=>n.id===x.id);console.log("in resolve:",!!n);
const users=m.resolve.nodes.filter(n=>n.deps.some(d=>d.pkg===x.id)).map(n=>n.id+" "+JSON.stringify(n.deps.find(d=>d.pkg===x.id).dep_kinds));console.log(users.join("\n"))}})' "$package"
rm -rf "$dir"
