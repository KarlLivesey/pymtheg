# SW-3 evidence

[The scoreboard](scoreboard.md) reports raw and adjusted rates by language,
file scope and repository. The archived breakdown contains all stored link
combinations for the 53 finished repositories and the seven zero-scored
attempts from SW-1. The archive's `columns` array names each field in the
ordered `breakdown` tuples. A null reason means the graph recorded no reason
in that field. `eligible` is used for resolved or ambiguous rows, with the
remaining dispositions reserved for unresolved rows.

```sh
gzip -dc evidence/sw-3/breakdown.json.gz
node scripts/sweep/coverage.mjs --results evidence/sw-3/breakdown.json.gz
```

The sample archive contains the reference site keys, source file and line,
strata, scopes and reviewed labels. The support item catalog keeps the short
source excerpts used in the plan. The published evidence contains counts,
sampled sites and support examples. Checkouts and databases lived in dev-server
scratch.
