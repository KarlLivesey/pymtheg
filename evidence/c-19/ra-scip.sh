#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# C-19: run `rust-analyzer scip` on a clean copy of a fetched pin and record
# cost and side effects. One variant per call.
#   WORK/src/NAME      clean pinned checkout (fetch.sh)
#   WORK/ra/NAME.VAR   the copy rust-analyzer runs in (its target/ lands here)
#   WORK/cargo-VAR-NAME  a fresh CARGO_HOME, so downloads are measurable
#                       (or a shared one with OFFLINE=1 for an offline variant)
# Usage: ra-scip.sh WORK NAME VARIANT [CONFIG_JSON|""] [CARGO_HOME_TO_REUSE|""] [SUBDIR]
set -uo pipefail
work="$1"; name="$2"; var="$3"; config="${4:-}"; reuse="${5:-}"; sub="${6:-.}"
dest="$work/ra/$name.$var"
out="$work/out/$name.$var"
mkdir -p "$work/ra" "$work/out"
[ -e "$dest" ] && dest="$dest.retry$$" # an earlier attempt left a copy; nothing is deleted
cp -a "$work/src/$name" "$dest"
if [ -n "$reuse" ]; then export CARGO_HOME="$reuse"; export CARGO_NET_OFFLINE=true; else export CARGO_HOME="$work/cargo-$var-$name"; fi
mkdir -p "$CARGO_HOME"
cd "$dest"
export CARGO_BUILD_JOBS=8
# build output goes to disk scratch (memory-backed /dev/shm is shared and quota-limited)
export CARGO_TARGET_DIR="${PYM_SCRATCH:-$work}/target/$name.$var"
mkdir -p "$CARGO_TARGET_DIR"
args=(scip "$sub" --output "$out.scip" --num-threads 8)
if [ -n "$config" ]; then printf '%s' "$config" > "$out.config.json"; args+=(--config-path "$out.config.json"); fi
echo "rust-analyzer $(rust-analyzer --version) rustc $(rustc -V)" > "$out.meta.txt"
echo "lockfile-tracked: $(git ls-files Cargo.lock | wc -l)" >> "$out.meta.txt"
/usr/bin/time -v timeout 3600 rust-analyzer "${args[@]}" > "$out.stdout.txt" 2> "$out.stderr.txt"
echo "exit $?" >> "$out.meta.txt"
{
  echo "scip-bytes: $(stat -c %s "$out.scip" 2>/dev/null || echo 0)"
  echo "worktree-changes: $(git status --porcelain --untracked-files=no | wc -l)"
  git status --porcelain --untracked-files=no | head -5
  echo "crate-archives: $(find "$CARGO_HOME/registry/cache" -name '*.crate' 2>/dev/null | wc -l)"
  echo "crate-archive-bytes: $(du -sb "$CARGO_HOME/registry/cache" 2>/dev/null | cut -f1)"
  echo "registry-index-bytes: $(du -sb "$CARGO_HOME/registry/index" 2>/dev/null | cut -f1)"
  echo "git-deps-bytes: $(du -sb "$CARGO_HOME/git" 2>/dev/null | cut -f1)"
  echo "build-script-runs: $(find "$CARGO_TARGET_DIR" -path '*/build/*' -name output 2>/dev/null | wc -l)"
  echo "build-script-names: $(find "$CARGO_TARGET_DIR" -path '*/build/*' -name output 2>/dev/null | sed -E 's#.*/build/([^/]*)-[0-9a-f]{16}/output#\1#' | sort -u | tr '\n' ' ')"
  echo "proc-macro-dylibs: $(find "$CARGO_TARGET_DIR" -path '*/deps/*' -name '*.so' 2>/dev/null | wc -l)"
  echo "target-bytes: $(du -sb "$CARGO_TARGET_DIR" 2>/dev/null | cut -f1)"
  echo "duplicate-symbol-messages: $(grep -c "Duplicate symbol:" "$out.stderr.txt")"
  echo "duplicate-symbol-files: $(grep -B1 "Duplicate symbol:" "$out.stderr.txt" | grep -v -e "Duplicate symbol:" -e "^--$" | cut -d: -f1 | sort -u | wc -l)"
  echo "not-in-scip-document-messages: $(grep -c "should have been in an SCIP document" "$out.stderr.txt")"
} >> "$out.meta.txt"
grep -E "Elapsed|Maximum resident|User time|System time" "$out.stderr.txt" >> "$out.meta.txt"
cat "$out.meta.txt"
tail -5 "$out.stderr.txt" | grep -v -E "^\s+(Elapsed|Maximum|User|System|Command|Percent|Average|Exit|Socket|Signals|Swaps|File|Page|Voluntary|Involuntary|Minor|Major)" | head -5
