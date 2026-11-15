#!/usr/bin/env bash
# Run a command with Java hidden: PYM_TLC_JAR unset, every PATH entry naming
# java/jdk dropped, and a shim directory first on PATH whose `java` (and
# `quint`) log each call and exit 127. Prints the shim log path; an empty log
# after the run shows nothing tried to start Java or Quint.
set -euo pipefail
shim="${PYM_SCRATCH:-/tmp}/r1a-shim"
log="${PYM_SCRATCH:-/tmp}/r1a-java-calls.log"
mkdir -p "$shim"
: > "$log"
for tool in java quint; do
  printf '#!/bin/sh\necho "%s $*" >> %q\nexit 127\n' "$tool" "$log" > "$shim/$tool"
  chmod +x "$shim/$tool"
done
filtered="$(echo "$PATH" | tr ':' '\n' | grep -v -i -e java -e jdk | paste -sd:)"
export PATH="$shim:$filtered"
unset PYM_TLC_JAR JAVA_HOME
echo "no-java: java resolves to $(command -v java); PYM_TLC_JAR=${PYM_TLC_JAR-unset}" >&2
set +e
"$@"
status=$?
set -e
echo "no-java: shim log ($log) has $(wc -l < "$log") line(s)" >&2
cat "$log" >&2
exit $status
