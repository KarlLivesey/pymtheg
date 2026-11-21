# Rust receiver evidence

[Change note](../../docs/changes/C-31.md)

The ten pins are the same public Rust pins used for C-29. Both builds ran in
source-only mode on the dev server with Node 24 and Rust 1.98.1. Main was
`e291a60`. The SHA-256 digest in the coverage export identifies the candidate
build. All paths in the published rows are relative to the pinned checkout.

- [Cross-table](cross-table.tsv) gives exact counts per receiver class, target
  evidence and pin. A zero means the cell had no links on that pin.
- [Diagnosis](diagnosis.jsonl.gz) contains one JSON array per selected stored
  link. The fields are pin, file, line, column, start and end offsets, method,
  first reason, matching reasons, receiver class, target evidence, typing gap,
  named receiver types, library producer paths and checkout method candidates.
  The raw resolver trace and source excerpts stay in scratch.
- [Source review](source-review.tsv) identifies the ten reviewed links in each
  cell having at least 400 links. The sample ranks hash the pin, commit and
  site with `c31-diagnosis-v1`.
- [Core catalog](core-catalog.tsv) ties each shipped signature to its
  declaration under `library/core/src` in Rust 1.98.1.
- [Comparison](comparison.json) counts every previously definite link checked,
  every symbol identity checked and all Rust coverage totals on both builds.
- [Gain review](gain-review.tsv) lists the 30 lowest hash ranks among new
  Level 2 links using `c31-gains-v1`.
- [Paired cold cost](cost-paired.json) records the timing and memory
  observations on redb and Fjall.
- [Coverage export](coverage-plan-input.json.gz) is the SW-4 inventory for the
  candidate source-only subset. The full main plan also needs the other pins
  and modes.

## Reproduce the measurements

Use the ten matching entries in `sweep/repos.json`.
Run `scripts/sweep/run.mjs` with `--local-build`, the filtered manifest and
`--parallel 4`. Put the baseline build in `$PYM_SCRATCH/main-build` with its
`dist` directory. Use `$PYM_SCRATCH/main` for the baseline scratch root and
`$PYM_SCRATCH/main.json` for its receipts. Use the corresponding
`final-build`, `final` and `final.json` for the candidate.

From the mirrored candidate tree, run the following on the dev server.

```sh
node evidence/c-31/diagnose.mjs
node evidence/c-31/tabulate.mjs
node evidence/c-31/check-catalog.mjs
node evidence/c-31/compare.mjs
node evidence/c-31/cost.mjs
node scripts/sweep/coverage-export.mjs --refresh \
  --results "$PYM_SCRATCH/final.json" --scratch "$PYM_SCRATCH/final" \
  --output "$PYM_SCRATCH/final-export.json"
```

The diagnosis script probes a copy of the compiled main resolver against the
captured file, context, symbol and link facts in each baseline SQLite store.
It records where lookup stopped and separately asks main's library lookup
which types or producers the source names. It uses the pinned source text
stored alongside those facts for review. Checkout impl matches and library
bindings are evidence about possible declarations. They are not method
selection results.

For the cold cost runs, the script clones each pin from the completed baseline
checkout into three fresh work directories on the same disk. It runs main,
candidate and main with the same CLI command and records elapsed time, CPU
time and peak RSS.
