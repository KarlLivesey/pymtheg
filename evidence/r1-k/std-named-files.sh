#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Files of a Rust tree that import `similar_asserts::assert_eq`, or define or
# import any macro named like one of the standard format macros (R1-K round 4
# targeted sample). Usage: std-named-files.sh <source-root>
cd "$1" || exit 1
names='print|println|eprint|eprintln|format|format_args|write|writeln|panic|todo|unreachable|unimplemented|assert|assert_eq|assert_ne|debug_assert|debug_assert_eq|debug_assert_ne|dbg|vec|matches'
grep -rlE --include=*.rs "macro_rules! *($names)\b|use [^;]*\b($names)\b[^;]*;" . | sed 's#^\./##' | sort
