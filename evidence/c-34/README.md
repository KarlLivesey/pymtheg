# Rust macro-scope evidence

[Change note](../../docs/changes/C-34.md)

The source-only baseline is `c6b77dc`. Use the ten Rust pins from the C-31
manifest selection in `sweep/repos.json`. Put the baseline build under
`$PYM_SCRATCH/main-build` and index the pins with `scripts/sweep/run.mjs
--local-build` into `$PYM_SCRATCH/main` with receipts `$PYM_SCRATCH/main.json`.
Use `final-build`, `final` and `final.json` for the candidate. Run the evidence
scripts from the mirrored tree on the dev server.

```sh
node evidence/c-34/diagnose.mjs
node evidence/c-34/tabulate.mjs
node evidence/c-34/compare.mjs
node evidence/c-31/cost.mjs
```

The Rust compiler controls use a scratch copy of the graph fixture.

```sh
cp -R test/fixtures/graph-rust-c34 "$PYM_SCRATCH/c34-fixture"
cargo check --all-targets --offline --manifest-path "$PYM_SCRATCH/c34-fixture/Cargo.toml"
node --test test/graph-rust-macro-scope.test.mjs
```

- [Census](diagnosis-counts.tsv) counts all stored sites, including secondary
  reasons. `classes` counts each link once. `origins`, `namespaces`,
  `positions` and `causes` count a link once for every applicable row. `sole` and `several`
  describe the stored reasons, independent of the number of opaque origins.
- [Per-link export](diagnosis.jsonl.gz) has one row per site carrying the
  reason. Each read contains the searched namespace, the scope relation, the
  queried name, whether the existing bound excludes the name, whether the
  bound contains the name and a set index. A `set` row gives the origin
  indexes in that set. An `origin` row gives the pin and source descriptor.
  The replay instruments a scratch copy of compiled main and reads captured
  facts from the baseline graph store. The replayed reads can cover several
  resolver branches. It also traces the lookup of each of the 630 derived
  calls carrying the reason.
- [Source review](source-review.tsv) identifies the ten lowest hash ranks per
  class with at least 200 links. The seed is `c34-opaque-v1`. Origins are
  sampled across both single- and multiple-class sites. The mixed and already
  bounded rows have their own samples.
- [Comparison](comparison.json) reports every prior definite-target and
  symbol-identity comparison, as well as stored reason transitions.
- [Gain review](gain-review.tsv) uses the fixed `c31-gains-v1` site ranks
  from the shared comparison script.
- [Cold cost](cost-paired.json) records three complete runs per selected pin,
  in the order main, candidate, main, in one server session.
  [Fjall repeat](cost-fjall-alone.json) repeats that sequence after the ten-pin
  sweep finished.
- [Coverage export](coverage-plan-input.json.gz) is the SW-4 inventory of the
  ten candidate runs. The coverage plan on main regenerates from a full
  sweep, so this change adds only the measured subset input.
