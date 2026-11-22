#!/usr/bin/env bash
# format.sh FILE... : prettier --write on the dev server's mirror of these
# files; the caller copies them back.
set -u
npx prettier --write "$@" > /dev/null
echo formatted
