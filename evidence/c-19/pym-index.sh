#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: index a clean copy of a fetched pin with this checkout's build (main),
# source-only (the default settings). Writes WORK/pym/<name>/.pymtheg/...
# Usage: pym-index.sh BUILD WORK NAME [DESTNAME]
set -uo pipefail
build="$1"; work="$2"; name="$3"; destname="${4:-$3}"
dest="$work/${PYMDIR:-pym}/$destname"
mkdir -p "$work/${PYMDIR:-pym}"
cp -a "$work/src/$name" "$dest"
cd "$dest"
node "$build/dist/cli/main.js" init . --name c19 --format json > "$work/${PYMDIR:-pym}/$destname.init.json"
/usr/bin/time -v node "$build/dist/cli/main.js" graph index --root . --json > "$work/${PYMDIR:-pym}/$destname.index.json" 2> "$work/${PYMDIR:-pym}/$destname.time.txt"
echo "exit $?"
grep -E "Elapsed|Maximum resident|User time|System time" "$work/${PYMDIR:-pym}/$destname.time.txt"
