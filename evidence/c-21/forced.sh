#!/usr/bin/env bash
# C-21 attribution control: index a clone of a pinned checkout with a build,
# after appending a syntax error to the named files (forcing them to fail as
# they did on main). Prints the graph path.
#   bash forced.sh WORK BUILD CHECKOUT FILE...
set -euo pipefail
work=$1 build=$2 checkout=$3
shift 3
git -c advice.detachedHead=false clone -q --no-hardlinks "$checkout" "$work"
for file in "$@"; do printf '\nfn forced_failure( {\n' >> "$work/$file"; done
cd "$work"
node "$build/dist/cli/main.js" init . --name forced --format json > /dev/null
/usr/bin/time -o "$work.time" -f "%e %U %M" node "$build/dist/cli/main.js" graph index --root . --json > "$work.index.json" 2> "$work.index.err" || true
echo "$work/.pymtheg/rebuildable/graph.sqlite"
