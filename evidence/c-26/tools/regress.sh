#!/usr/bin/env bash
# regress.sh : reverts C-26's two fold-ins in the compiled module (retract
# only for files outside the current project; the cap ignoring imported
# failures), runs their tests, then rebuilds.
set -u
npx tsc -p .
f=dist/graph/languages/typescript/index.js
grep -c "retract(blamed, outcome.assertion);" "$f"
grep -c "++compilerFailures + inherited() <" "$f"
sed -i "s/retract(blamed, outcome.assertion);/if (!group.roots.includes(toVirtual(blamed))) retract(blamed, outcome.assertion);/" "$f"
sed -i "s/++compilerFailures + inherited() </++compilerFailures </" "$f"
node --test --test-name-pattern="later project|imports from another" test/graph-typescript-large.test.mjs 2>&1 | grep -E "^✔|^✖" | head -4
npx tsc -p .
