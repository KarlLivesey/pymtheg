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
  pages. The product uses a connection-local cache budget in KiB.

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
```

The [change note](../../docs/changes/C-33.md) shows the measurements, work
counts, and why the faster paths preserve the graph.
