#!/usr/bin/env bash
# trace.sh BUILD NAME : copies BUILD's dist into $PYM_SCRATCH/NAME, patches
# it with evidence/c-13/tools/tracefiles.mjs (taint walk, extraction and
# worklist logs with heap and time), and starts analyze.mjs on the
# microsoft/TypeScript checkout in the background (bg.sh NAME).
set -u
tree="$PWD"
build="$1"
name="$2"
dir="$PYM_SCRATCH/$name"
mkdir -p "$dir"
cp -a "$build/dist" "$build/package.json" "$dir/"
ln -sfn "$build/node_modules" "$dir/node_modules"
node "$tree/evidence/c-13/tools/tracefiles.mjs" "$dir"
bash "$tree/evidence/c-26/tools/bg.sh" "$name" node "$tree/evidence/c-13/tools/analyze.mjs" "$dir" "$PYM_SCRATCH/src/typescript"
