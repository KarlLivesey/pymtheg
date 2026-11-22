#!/bin/sh
# SPDX-License-Identifier: MIT
# C-40: a cold `graph index` through the CLI, at Node's default heap, on a
# fresh copy of <pin dir>, with peak RSS, wall time and exit status from
# /usr/bin/time. The copy goes in <work dir>; the JSON report and the time
# log go to <out prefix>.json and .log.
#   scripts/memory/cli-index.sh <dist> <pin dir> <work dir> <out prefix>
set -u
# The user's Pymtheg configuration and cache go to fresh folders in the
# scratch, never the account's real ones (scripts/isolated-home.mjs).
export PYMTHEG_CONFIG_HOME="${PYMTHEG_CONFIG_HOME:-$(mkdir -p "${PYM_SCRATCH:-${TMPDIR:-/tmp}}" && mktemp -d "${PYM_SCRATCH:-${TMPDIR:-/tmp}}/pym-config-XXXXXX")}"
export PYMTHEG_CACHE_HOME="${PYMTHEG_CACHE_HOME:-$(mkdir -p "${PYM_SCRATCH:-${TMPDIR:-/tmp}}" && mktemp -d "${PYM_SCRATCH:-${TMPDIR:-/tmp}}/pym-cache-XXXXXX")}"
dist=$1 pin=$2 work=$3 out=$4
mkdir -p "$(dirname "$work")" "$(dirname "$out")"
cp -a "$pin" "$work"
cd "$work" || exit 1
node "$dist/cli/main.js" init . --name memory --format json > /dev/null
/usr/bin/time -v node "$dist/cli/main.js" graph index --root . --json > "$out.json" 2> "$out.log"
echo "exit $?" >> "$out.log"
grep -E "^exit|Maximum resident|Elapsed \(wall" "$out.log"
