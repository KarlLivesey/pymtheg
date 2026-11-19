#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: fetch one sweep pin into WORK/src/<name> (shallow, pinned SHA, no hooks,
# no submodules), the way scripts/sweep/run.mjs does.
# Usage: fetch.sh WORK NAME URL SHA
set -euo pipefail
work="$1"; name="$2"; url="$3"; sha="$4"
dir="$work/src/$name"
mkdir -p "$dir"
cd "$dir"
git -c core.hooksPath=/dev/null init --template= --quiet
git -c core.hooksPath=/dev/null fetch --quiet --depth 1 --no-tags --no-recurse-submodules "$url" "$sha"
git -c core.hooksPath=/dev/null checkout --quiet --detach FETCH_HEAD
test "$(git rev-parse HEAD)" = "$sha"
echo "$name $sha $(git ls-files '*.rs' | wc -l) rs files"
