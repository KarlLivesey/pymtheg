#!/usr/bin/env bash
# others.sh : runs hang-probe.mjs (40 s limit) on each flagged sibling file
# alone, and fetches the seven identity pins.
set -u
tree="$PWD"
for name in unreachableFlowAfterThrowingForInOfHead1 unreachableFlowAfterThrowingForInOfHead2; do
  dir="$PYM_SCRATCH/hang-$name"
  mkdir -p "$dir"
  cp "$PYM_SCRATCH/src/typescript/tsc/testdata/tests/cases/compiler/$name.ts" "$dir/h.ts"
  git -C "$dir" init -q
  git -C "$dir" add .
  echo "-- $name"
  timeout 40 node "$tree/evidence/c-26/tools/hang-probe.mjs" "$tree" "$dir" | tail -n 2
  echo "exit $?"
done
f() { bash evidence/c-13/tools/fetch.sh "$@"; }
f excalidraw https://github.com/excalidraw/excalidraw.git 680f58ccfdaa1ae5b7f606ad4568f6df46acacb5 &
f vitest https://github.com/vitest-dev/vitest.git 161e25f663a838f6a30890f8a6827ff83ff1b3c7 &
f trpc https://github.com/trpc/trpc.git 1abda6cc6cd9ac149e474936f5dfcb679a983fb3 &
f astro https://github.com/withastro/astro.git 3ac5ad3ae05ddc461bcc7748f0c55fd6da056652 &
f hono https://github.com/honojs/hono.git 676c8f80fcafc49e6e74c847a8f0d9c44cc7faee &
f rtk https://github.com/reduxjs/redux-toolkit.git 1a7d3b5251ceda61b77928e357a22086b45aaab1 &
f vite https://github.com/vitejs/vite.git 60c260dea1fa9f628c22e32b14dddf6ca3088f2b &
wait
