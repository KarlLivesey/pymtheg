# SW-3 evidence

[The scoreboard](scoreboard.md) reports raw and adjusted rates by language,
file scope and repository. The archived breakdown contains all stored link
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

The sample archive contains the reference site keys, source file and line,
strata, scopes and reviewed labels. The support item catalog keeps the short
source excerpts used in the plan. The published evidence contains counts,
sampled sites and support examples. Checkouts and databases lived in dev-server
scratch. [Sample sizes and populations](sampling.md)

The warm CLI totals agree with the exported store for all 53 replayed pins.
The replay and SW-1 have the same outcome counts in 52 graphs. Pebble has the
same 210,500 links. Its replay has six fewer resolved links, four more ambiguous
links and two more unresolved links. Its replay cold and warm counts agree.
The scoreboard uses the replayed graph.

To reproduce the baseline from fresh graph stores, run the SW-1 runner with
a manifest containing the 53 previously finished pins. Then run
`coverage-export.mjs --results "$PYM_SCRATCH/results.json" --include-failed
evidence/sw-1/results.json --output "$PYM_SCRATCH/audit.json"` on the dev
server. The seven historical attempts retain their recorded outcomes.
