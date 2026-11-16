#!/bin/sh
# SPDX-License-Identifier: MIT
# Installed as java, javac, quint, tlc, go, cargo, rustc and rustup in a
# directory put first on PATH. Every invocation is logged; the real program
# (if the scenario installed one) then runs unchanged, otherwise the shim
# fails like a missing command.
#
# Shell built-ins only, a fixed log path and a fixed fallback search path: a
# toolchain route may run the program with a stripped environment (no
# ACC_SHIM_LOG, a minimal PATH), and its call must still be logged and reach
# the real program.
name=${0##*/}
shim_dir=${0%/*}
printf '%s %s\n' "$name" "$*" >>"${ACC_SHIM_LOG:-/acc/out/shim.log}"
old_ifs=$IFS
IFS=:
for dir in $PATH /usr/local/go/bin /usr/local/cargo/bin /usr/local/sbin /usr/local/bin /usr/sbin /usr/bin /sbin /bin; do
  [ "$dir" = "$shim_dir" ] && continue
  if [ -x "$dir/$name" ]; then
    IFS=$old_ifs
    exec "$dir/$name" "$@"
  fi
done
echo "$name: not installed in this acceptance container" >&2
exit 127
