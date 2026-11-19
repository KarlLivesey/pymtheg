#!/usr/bin/env bash
# C-21: build main (a fresh clone of the public repository at a given commit)
# and this branch (a copy of the synced checkout) as --local-build directories.
#   bash builds.sh OUT MAIN_COMMIT BRANCH_CHECKOUT
set -euo pipefail
out=$1 commit=$2 checkout=$3
mkdir -p "$out/main"
git -C "$out/main" init -q
git -C "$out/main" fetch -q --depth 1 https://github.com/KarlLivesey/pymtheg.git "$commit"
git -C "$out/main" -c advice.detachedHead=false checkout -q FETCH_HEAD
(cd "$out/main" && npm ci --ignore-scripts --no-audit --no-fund > /dev/null && npm run build > /dev/null)
mkdir -p "$out/branch"
tar -C "$checkout" --exclude=./.git --exclude=./node_modules -cf - . | tar -C "$out/branch" -xf -
(cd "$out/branch" && npm ci --ignore-scripts --no-audit --no-fund > /dev/null && npm run build > /dev/null)
for build in main branch; do
  echo "$build $(git -C "$out/main" rev-parse HEAD 2>/dev/null | head -c 0)$(sha256sum "$out/$build/grammars/rust/tree-sitter-rust.wasm" | cut -c1-12) version $(grep -o 'version: "[0-9]*"' "$out/$build/src/graph/languages/rust/index.ts")"
done
