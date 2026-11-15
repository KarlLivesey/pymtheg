#!/bin/sh
# Installed as java, quint, go, cargo, rustc, rustup and tlc in a directory put
# first on PATH. Every invocation is logged to $ACC_SHIM_LOG; the real program
# (if the scenario installed one) then runs unchanged, otherwise the shim
# fails like a missing command.
name=$(basename "$0")
printf '%s %s\n' "$name" "$*" >>"${ACC_SHIM_LOG:-/dev/null}"
shim_dir=$(dirname "$0")
old_ifs=$IFS
IFS=:
for dir in $PATH; do
  [ "$dir" = "$shim_dir" ] && continue
  if [ -x "$dir/$name" ]; then
    IFS=$old_ifs
    exec "$dir/$name" "$@"
  fi
done
echo "$name: not installed in this acceptance container" >&2
exit 127
