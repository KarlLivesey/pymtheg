#!/usr/bin/env bash
# cost.sh BUILD TAG ID : cold `graph index` of a fresh copy of the pristine
# checkout $PYM_SCRATCH/src/ID with BUILD's CLI on Node's default heap.
# Prints "TAG ID exit wall-seconds peak-RSS-KiB" (GNU time). Work copies go
# under $PYM_SCRATCH/cost/TAG/ID and are left for `pymtheg-dev --clean`.
set -uo pipefail
build="$1"; tag="$2"; id="$3"
w="$PYM_SCRATCH/cost/$tag/$id"
[ -e "$w" ] && { echo "exists: $w"; exit 1; }
mkdir -p "$(dirname "$w")"
cp -a --reflink=auto "$PYM_SCRATCH/src/$id" "$w"
cd "$w"
node "$build/dist/cli/main.js" init . --name "$id" --format json > "$w.init" 2>&1
/usr/bin/time -f '%e %M' -o "$w.time" node "$build/dist/cli/main.js" graph index --root . --json > "$w.json" 2> "$w.err"
echo "$tag $id exit=$? $(cat "$w.time" | tail -1)"
