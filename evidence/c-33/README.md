# C-33 evidence

The baseline is `ecc0c2d` with observation counters for the new stage split.
The measured after build is `8f9bcf8`. The source pins are in
[`sweep/repos.json`](../../sweep/repos.json). Hono and ripgrep use bare
checkouts. Each warm measurement runs the normal command entry point in a
fresh process. The body edits and their anchors are in
[`scripts/reindex/cases.json`](../../scripts/reindex/cases.json).

- `before/` and `after/` contain one no-edit and one body run per pin. The
  stores after the reverts matched the starting graph. The no-edit totals
  include process startup and command module loading. The raw JSON keeps
  nested scopes so the table subtracts overlaps.
- `profile-*.txt` summarizes V8 samples from the two largest Go pins.
  The profiles sample the main thread in elapsed time. Process CPU stages
  also count worker activity, so the two time columns have different units
  of observation. The profiles identified record decoding, glob compilation,
  selector work in interface checking and SQLite journal switching.
- `cache-knee.json` uses the production store with a default, 16 MiB and
  64 MiB SQLite page cache. The page counts in this experiment use 4 KiB
  pages. `cache-larger.json` records the 128 and 256 MiB follow-up. The
  product uses a connection-local cache budget in KiB.
- `cold-a.json` and `cold-b.json` compare all persisted graph facts against
  `ecc0c2d` using the same project ID and no normalisation. The Rust pin
  was repeated against `c6b77dc` after merging C-31. Its equal-row result
  and costs are in `cold-rust-merged.json`.
- `random-33301.json` through `random-33304.json` record two 30-edit
  restic sequences and two 10-edit cli/cli sequences for `e6d7f17`.
  Seeds `33305` and `33306` run on the later merged build `a3c555a`.
  All 85 comparisons used the production SQLite store for both sides.

Regenerate the stage table with:

```sh
node scripts/reindex/table.mjs evidence/c-33/before fixed evidence/c-33/after
```

Run the baseline warm measurements on the dev server after fetching the
pins with `scripts/reindex/fetch.mjs`. For example:

```sh
node scripts/reindex/measure.mjs <main-dist> "$PYM_SCRATCH" cli/cli "$PYM_SCRATCH/before-cli" --store-dir /dev/shm/c33 --edits body --profile warm,body
node scripts/reindex/measure.mjs <after-dist> "$PYM_SCRATCH" cli/cli "$PYM_SCRATCH/after-cli" --cold-store "$PYM_SCRATCH/work/before-cli/cli_cli/.pymtheg/rebuildable/graph.sqlite" --edits body --profile warm,body
node scripts/reindex/cold-cost.mjs /dev/shm/c33 "$PYM_SCRATCH/cold-cli.json" 1 main-1=<main-dist> after=<after-dist> main-2=<main-dist> --exact -- "$PYM_SCRATCH/pins/cli_cli"
node scripts/reindex/random-edits.mjs <dist> "$PYM_SCRATCH" restic/restic 33301 30 "$PYM_SCRATCH/random-33301.json" --store-dir /dev/shm/c33 --cache-pages 131072
node scripts/reindex/random-edits.mjs <dist> "$PYM_SCRATCH" cli/cli 33303 10 "$PYM_SCRATCH/random-33303.json" --store-dir /dev/shm/c33 --cache-pages 196608
```

The [change note](../../docs/changes/C-33.md) shows the measurements, work
counts, and why the faster paths preserve the graph.
