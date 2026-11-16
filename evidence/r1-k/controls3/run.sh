#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# R1-K round 3 compiler controls (dev server; evidence only). Prints what each
# program prints, or its first error line.
set -u
cd "$(dirname "$0")"
out="${PYM_SCRATCH:-/tmp}/r1k-controls3"; mkdir -p "$out"
rustc --version
for f in *.rs; do
  if rustc --edition 2021 -A warnings -o "$out/${f%.rs}" "$f" 2>"$out/${f%.rs}.err"; then
    printf '%-28s prints: %s\n' "$f" "$("$out/${f%.rs}" 2>&1 | tr '\n' ' ')"
  else
    printf '%-28s does not compile: %s\n' "$f" "$(grep -m1 '^error' "$out/${f%.rs}.err")"
  fi
done
