#!/usr/bin/env bash
# Stop this mirror's running `npm test` (processes whose working directory is
# this tree), leaving other mirrors' runs alone. Run from the tree root.
tree=$(pwd)
for pid in $(pgrep -f "npm test|node --test"); do
  [ "$(readlink "/proc/$pid/cwd")" = "$tree" ] && [ "$pid" != "$$" ] && kill "$pid" && echo "stopped $pid"
done
