#!/usr/bin/env bash
# fetch.sh ID URL SHA : pristine shallow checkout under $PYM_SCRATCH/src/ID
set -euo pipefail
id="$1"; url="$2"; sha="$3"
d="$PYM_SCRATCH/src/$id"
[ -e "$d/.done" ] && exit 0
mkdir -p "$d"; cd "$d"
git -c core.hooksPath=/dev/null init --template= --quiet
git fetch --quiet --depth 1 --no-tags --no-recurse-submodules "$url" "$sha"
git checkout --quiet --detach FETCH_HEAD
[ "$(git rev-parse HEAD)" = "$sha" ] || { echo "sha mismatch $id"; exit 1; }
touch .done
echo "fetched $id"
