#!/usr/bin/env bash
# trace-calls.sh BUILD NAME FILE_PART : like trace.sh, and also logs every
# checker call on nodes in files whose name contains FILE_PART
# (evidence/c-13/tools/tracecalls.mjs), with heap and stack.
set -u
tree="$PWD"
build="$1"
name="$2"
part="$3"
dir="$PYM_SCRATCH/$name"
mkdir -p "$dir"
cp -a "$build/dist" "$build/package.json" "$dir/"
ln -sfn "$build/node_modules" "$dir/node_modules"
node "$tree/evidence/c-13/tools/tracefiles.mjs" "$dir"
node "$tree/evidence/c-13/tools/tracecalls.mjs" "$dir" "$part"
bash "$tree/evidence/c-26/tools/bg.sh" "$name" node --stack-trace-limit=40 "$tree/evidence/c-13/tools/analyze.mjs" "$dir" "$PYM_SCRATCH/src/typescript"
