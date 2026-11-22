#!/usr/bin/env bash
# dbg-index.sh BUILD : copies BUILD to $PYM_SCRATCH/dbg-build, makes its
# invalid-link check name the link and a few symbol keys of its result, and
# runs a cold `graph index` of a fresh copy of the microsoft/TypeScript
# checkout with it; the report goes to $PYM_SCRATCH/out/dbg-index.json.
set -u
build="$PYM_SCRATCH/dbg-build"
work="$PYM_SCRATCH/dbg/typescript"
mkdir -p "$PYM_SCRATCH/dbg"
cp -a --reflink=auto "$1" "$build"
sed -i 's|throw Error("Invalid link source/kind/target name")|throw Error("Invalid link source/kind/target name " + JSON.stringify({ link, keys: [...keys].slice(0, 3) }).slice(0, 2000))|' "$build/dist/graph/identity.js"
grep -c "keys: \[...keys\]" "$build/dist/graph/identity.js"
cp -a --reflink=auto "$PYM_SCRATCH/src/typescript" "$work"
cd "$work" || exit 1
node "$build/dist/cli/main.js" init . --name typescript --format json > /dev/null 2>&1
/usr/bin/time -f "%M %e" -o "$PYM_SCRATCH/out/dbg-index.time" node "$build/dist/cli/main.js" graph index --root . --json > "$PYM_SCRATCH/out/dbg-index.json" 2> "$PYM_SCRATCH/out/dbg-index.log"
echo done > "$PYM_SCRATCH/out/dbg-index.done"
