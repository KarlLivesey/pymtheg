#!/usr/bin/env bash
# C-5 identity evidence, run on the dev server from a mirrored tree of the
# branch: `pymtheg-dev --name NAME -- bash evidence/c-5/run-identity.sh`.
# Compares the base commit's build with this branch's build on three
# corpus repositories (one per language).
set -euo pipefail
BASE=32ca7571c9cb5f8bef6c02d3e619ba63584bf6a3
B=$PWD
M=$PYM_SCRATCH/base
OUT=$PYM_SCRATCH/c5
mkdir -p "$OUT"
npm ci --no-audit --no-fund >/dev/null 2>&1 && npx tsc -p .
[ -d "$M" ] || git clone -q https://github.com/KarlLivesey/pymtheg.git "$M"
git -C "$M" checkout -q "$BASE"
(cd "$M" && npm ci --no-audit --no-fund >/dev/null 2>&1 && npx tsc -p .)
# The exporter reads TypeScript sources with the released package's compiler.
[ -f "$PYM_SCRATCH/release/node_modules/typescript/lib/typescript.js" ] ||
  npm install --prefix "$PYM_SCRATCH/release" --cache "$PYM_SCRATCH/npm-cache" --ignore-scripts \
    --no-audit --no-fund --save-exact pymtheg@0.1.0 >/dev/null
for side in base branch; do
  build=$M; [ $side = branch ] && build=$B
  node scripts/sweep/run.mjs --manifest evidence/c-5/affected.json --local-build "$build" \
    --output "$OUT/$side-run.json" --parallel 3
  node scripts/sweep/coverage-export.mjs --results "$OUT/$side-run.json" --output "$OUT/$side-coverage.json"
  node scripts/sweep/coverage.mjs --results "$OUT/$side-coverage.json" --scoreboard "$OUT/$side-score.md"
done
for attempt in $(node -e 'for (const r of require(process.argv[1]).repos) console.log(r.attempt)' "$OUT/base-run.json"); do
  for side in base branch; do
    build=$M; [ $side = branch ] && build=$B
    rm -f "$OUT/id-$side.sqlite"*
    node evidence/c-5/identity.mjs "$build" "$PYM_SCRATCH/$attempt/checkout" "$OUT/id-$side.sqlite" > "$OUT/id-$side.json"
  done
  node -e '
    const [a, b] = process.argv.slice(1).map((f) => JSON.parse(require("fs").readFileSync(f, "utf8")));
    const tables = [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort();
    const diff = tables.filter((t) => JSON.stringify(a.tables[t]) !== JSON.stringify(b.tables[t]));
    console.log(JSON.stringify({ checkout: a.checkout, schema: [a.schema, b.schema], links: [a.links, b.links],
      library: b.library, differing: diff.map((t) => ({ table: t, base: a.tables[t] ?? null, branch: b.tables[t] ?? null })) }));
  ' "$OUT/id-base.json" "$OUT/id-branch.json"
done
grep -h "^| \(charmbracelet\|rust-embedded\|yargs\)" "$OUT/base-score.md" "$OUT/branch-score.md"
