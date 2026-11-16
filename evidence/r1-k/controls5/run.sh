#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# R1-K round 5: #[macro_export(local_inner_macros)] (dev server; evidence only).
set -u
cd "$(dirname "$0")"
out="${PYM_SCRATCH:-/tmp}/r1k-controls5"; mkdir -p "$out"
rustc --version
run() { # <lib dir> <program>
  rustc --edition 2021 --crate-type lib --crate-name m -A warnings -o "$out/libm-$1.rlib" "$1/lib.rs" || return
  if rustc --edition 2021 -A warnings --extern m="$out/libm-$1.rlib" -o "$out/${2%.rs}" "$2" 2>"$out/${2%.rs}.err"; then
    printf '%-34s prints: %s\n' "$2" "$("$out/${2%.rs}" 2>&1 | tr '\n' ' ')"
  else printf '%-34s does not compile: %s\n' "$2" "$(grep -m1 '^error' "$out/${2%.rs}.err")"; fi
}
run m_body l1_body_call.rs
run m_arg l2_forwarded_argument.rs
run m_std l3_std_named.rs
run m_twin l4_twin_without_local_inner.rs
