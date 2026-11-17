# SW-3 evidence

[The scoreboard](scoreboard.md) separates the completion checklist from
raw, strict and estimated-true coverage in the finished graphs, with
file-scope variants and repository scores. The archived breakdown contains all stored link
combinations for the 53 finished repositories and the seven zero-scored
attempts from SW-1. The archive's `columns` array names each field in the
ordered `breakdown` tuples. A null reason means the graph recorded no reason
in that field. `eligible` is used for resolved or ambiguous rows, with the
remaining dispositions reserved for unresolved rows. `blocked` is the number
of links in that tuple whose stored data marks them blocked.

```sh
gzip -dc evidence/sw-3/breakdown.json.gz
node scripts/sweep/coverage.mjs --results evidence/sw-3/breakdown.json.gz
```

The sample archive contains reference site keys, source file and line,
strata, scopes, labels and the basis for each label. The support item catalog keeps the short
source excerpts used in the plan. The published evidence contains counts,
sampled sites and support examples. Checkouts and databases lived in dev-server
scratch. [Sample sizes and populations](sampling.md)

The warm CLI totals agree with the exported store for all 53 replayed pins.
All 53 have the same link volume as SW-1. The current replay differs from
SW-1 in three Go graphs. Fiber has 21 fewer resolved links, Go tools has 109
fewer, and Protobuf has two fewer. Those differences put the Go strict figure
at 77.75%, compared with 77.76% in the earlier SW-3 export. Pebble now agrees
with SW-1. The scoreboard uses the current replay.

To reproduce the baseline from fresh graph stores, run the SW-1 runner with
a manifest containing the 53 previously finished pins. Then run the exporter
on the dev server. The seven historical attempts retain their recorded outcomes.

```sh
node scripts/sweep/coverage-export.mjs --results "$PYM_SCRATCH/results.json" \
  --include-failed evidence/sw-1/results.json \
  --sampling-base evidence/sw-3/breakdown.json.gz \
  --output "$PYM_SCRATCH/audit.json"
```

To recalculate the tables and check the published labels, use the archived data.

```sh
node scripts/sweep/coverage.mjs --results evidence/sw-3/breakdown.json.gz \
  --plan docs/coverage-plan.md --scoreboard evidence/sw-3/scoreboard.md \
  --sampling-report evidence/sw-3/sampling.md
```
