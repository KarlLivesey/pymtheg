# C-35 evidence

Every run is a cold index of a bare checkout of the pin in
[`sweep/repos.json`](../../sweep/repos.json), on the shared dev server, by
[`scripts/store-cost/measure.mjs`](../../scripts/store-cost/measure.mjs)
through [`run.sh`](../../scripts/store-cost/run.sh). The script records, per
SQL statement, calls, wall time (including the triggers and index updates
it causes), rows changed and bytes bound; the indexer's stages and counts;
bytes the process wrote (`/proc/self/io`); and, after the run, the size of
every table and index (`dbstat`) and a SHA-256 digest of every compared
table's rows (`rows.mjs`). Timings are observations; counts and digests are
deterministic.

- `cold.json.gz`: per pin, main and this change, with the store in memory
  and on disk, and the repeat after merging main `2dc05be`. `rows` holds
  the digests that prove each pair equal.
- `variants.json.gz`: measurement-only variants on top of the change: no
  invalidation triggers, indexes built at the end, 50 commits merged into
  one on disk; and four trpc repeats for its peak memory.
- `micro.txt`: the per-row cost of the schema's writes, isolated.
- `checks.json`: the test suite, equality proofs and the seeded edits.

The tables in the [change note](../../docs/changes/C-35.md) come from
[`table.mjs`](../../scripts/store-cost/table.mjs) and
[`summary.mjs`](../../scripts/store-cost/summary.mjs).

One correction during measurement: the first copy of main's build lacked
`src/`, from which the Go module reads its standard-library table, so its
Go stores had fewer library targets. Those runs were discarded and main
was measured again from a complete copy; every number here uses that.
