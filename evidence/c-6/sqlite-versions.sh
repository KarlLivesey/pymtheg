#!/usr/bin/env bash
# The SQLite bundled with Node releases: every image the acceptance gate runs
# (scripts/acceptance/run.mjs) and the 24.x and 25.x releases around the
# first fixed one. Prints "<image tag> <node version> <sqlite version>".
#   bash evidence/c-6/sqlite-versions.sh [tag...]
set -uo pipefail
tags=("$@")
[ ${#tags[@]} -gt 0 ] || tags=(24.0.0 24.4.0 24.8.0 24.12.0 24.21.0 24 25.0.0 25 26)
for tag in "${tags[@]}"; do
  printf '%s ' "$tag"
  docker run --rm "node:$tag-bookworm-slim" node -p 'process.version+" "+process.versions.sqlite' 2>&1 | tail -1
done
