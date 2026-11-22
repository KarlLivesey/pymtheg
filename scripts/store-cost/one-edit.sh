#!/bin/sh
# SPDX-License-Identifier: MIT
# C-37: one body edit of <file> after a cold index, through the CLI path
# (index-once.mjs), on a fresh copy of <pin dir>; then the edit is reverted
# and indexed again. Prints the edit's and the revert's SQL statements,
# rows written and CPU.
#   scripts/store-cost/one-edit.sh <dist> <pin dir> <work dir> <file> <out dir>
set -eu
dist=$1 pin=$2 work=$3 file=$4 out=$5
here=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$out" "$(dirname "$work")"
cp -a "$pin" "$work"
cd "$work"
node "$dist/cli/main.js" init . --name edit --format json > /dev/null
node "$here/reindex/index-once.mjs" "$dist" . "$out/cold.json"
cp "$file" "$out/original"
# The first function body gains a no-op statement.
node -e '
const fs = require("fs");
const [path] = process.argv.slice(1);
const text = fs.readFileSync(path, "utf8");
const at = text.search(/^func [^\n{}]*\{/m);
const end = text.indexOf("{", at) + 1;
fs.writeFileSync(path, text.slice(0, end) + " _ = 0;" + text.slice(end));
' "$file"
node "$here/reindex/index-once.mjs" "$dist" . "$out/edit.json"
cp "$out/original" "$file"
node "$here/reindex/index-once.mjs" "$dist" . "$out/revert.json"
for step in edit revert; do
  node -e '
const r = require(process.argv[1]);
console.log(process.argv[2], "statements", r.counts["store.sqlStatements"], "files written", r.counts["store.filesWritten"] ?? 0, "link rows inserted", r.counts["store.linkRowsInserted"] ?? 0, "target rows rewritten", r.counts["store.linkTargetsRewritten"] ?? 0, "cpu ms", r.cpuMs, "complete", r.complete);
' "$out/$step.json" "$step"
done
