#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: the cost of refreshing a toolchain index after a one-file edit.
# `rust-analyzer scip` has no incremental mode, so a refresh is a re-run; this
# re-runs it in the copy the first run used (target/ and CARGO_HOME warm,
# nothing to download) after appending one comment line to FILE.
# Usage: ra-rerun.sh WORK NAME FILE
set -uo pipefail
work="$1"; name="$2"; file="$3"
dest="$work/ra/$name.default"
[ -d "$dest" ] || dest="$PYM_SCRATCH/ra-moved/$name.default" # moved to disk to free memory
out="$work/out/$name.rerun"
export CARGO_HOME="$work/cargo-default-$name"
export CARGO_NET_OFFLINE=true
export CARGO_BUILD_JOBS=8
[ -d "${PYM_SCRATCH:-}/target/$name.default" ] && export CARGO_TARGET_DIR="$PYM_SCRATCH/target/$name.default"
cd "$dest"
echo "// c-19 one-file edit" >> "$file"
/usr/bin/time -v timeout 3600 rust-analyzer scip . --output "$out.scip" --num-threads 8 > "$out.stdout.txt" 2> "$out.stderr.txt"
echo "exit $?"
grep -E "Elapsed|Maximum resident|User time|System time" "$out.stderr.txt"
