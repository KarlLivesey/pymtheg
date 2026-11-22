# C-37 evidence

Cold indexes of bare checkouts of the pins in
[`sweep/repos.json`](../../sweep/repos.json) on the shared dev server, by
[`scripts/store-cost/measure.mjs`](../../scripts/store-cost/measure.mjs)
through [`pairs.sh`](../../scripts/store-cost/pairs.sh) and
[`run.sh`](../../scripts/store-cost/run.sh). Each result records, per SQL
statement, calls and wall time; commits; the final checkpoint on close; the
write lock's longest holds with what held them; bytes written
(`/proc/self/io`); the size of every table and index; and a SHA-256 digest
of every compared table's rows. Timings are observations; counts and
digests are deterministic.

- `cold.json.gz`: main (`5d97762`) and this change, each pin on disk and in
  memory-backed storage, run in pairs at the same time. Equal `rows`
  digests prove each pair row-for-row equal.
- `variants.json.gz`: the measurements behind the choices. Main with and
  without automatic checkpoints (where the commit time goes); the first
  version, which had a savepoint per write, at budgets of 5,000, 20,000 and
  50,000 rows and with checkpoints every 10,000 or 100,000 pages; and that
  version on helix in memory, where the savepoints made link inserts
  slower.
- `edits.json`: one-file edits on restic and cli/cli, three rounds of main
  and this change, with statement counts.
- `review.json.gz`: the review fixes. Main against this head on four pins
  on disk and in memory; this head beside the reviewed head `3756b30`; and
  every run with a second writer beside it, by checkpoint interval and
  with resolution writes in one transaction or cut at the budget.
- `waits.txt`: the second writer's waits in those runs, in seconds and in
  index commits inside each wait, with any "database is locked".
- `checks.json`: the test suite and the equality proofs.
