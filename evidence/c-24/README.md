# C-24 evidence: Rust determinism, unlocked facades, inherent impl crates

[Change note](../../docs/changes/C-24.md). Everything here ran on the dev
server with the pinned toolchains; scratch paths are under `$PYM_SCRATCH`.
Pins: [rust-pins.json](rust-pins.json) (the 19 Rust sweep pins without
swc) and [rust-pins-18.json](rust-pins-18.json) (the 18 coverage pins,
without embassy).

## Builds

- `main`: `origin/main` after C-21 and C-23 (`53d248f`), `npm run build`;
  before the merge, `e7585f2` for the pre-merge runs named below.
- `c24`: this branch merged with that main.
- `items-1`, `items-12`: the branch build with later items switched off in
  its compiled Rust module, for per-item attribution
  ([item-builds.mjs](item-builds.mjs); every replacement must match exactly
  once): `items-1` is determinism only, `items-12` adds the unlocked-facade
  rule, the full build adds the inherent-impl rule. Measured before the
  merge, on `e7585f2`.

## Results

- [proof.txt](proof.txt): the 10-run proof (embassy, dioxus, ratatui, axum:
  ten cold runs each, ten project ids, byte-identical normalised stores),
  the Go and TypeScript check (cobra, restic, yargs, zod: three runs each,
  identical), and the control (two embassy stores from main differ by 16
  lines).
- [union-final.json](union-final.json): the merged branch against the
  union of three merged-main sweeps on the 18 pins (per-pin Level 2,
  like-for-like, lost and retargeted links, main-unstable sites, symbol
  keys, the audit draw).
- [main-instability-merged.json](main-instability-merged.json),
  [main-instability-pre-merge.json](main-instability-pre-merge.json),
  [main-instability-embassy.json](main-instability-embassy.json): main's
  own runs against each other.
- [item1-vs-main.json](item1-vs-main.json),
  [item2-vs-item1.json](item2-vs-item1.json),
  [item3-vs-item2.json](item3-vs-item2.json): the per-item split.
- [audit.md](audit.md): 40 newly definite links at a fixed seed, 40 right.
- [cost.md](cost.md): cold index CPU and peak memory (side-by-side sweeps,
  controlled sequential runs) and the cost of the canonical order.
- [cargo-check.txt](cargo-check.txt): Cargo's own resolution of the item-2
  fixtures without a lockfile.
- [coverage-plan-input.json.gz](coverage-plan-input.json.gz): the plan
  input (the same bytes as `sweep/plan-input.json.gz`): C-21's archive with
  the 18 pins replaced by this chunk's export
  (`coverage-export.mjs`, then `evidence/c-15/plan.mjs`).

## Scripts

- [index-run.mjs](index-run.mjs): one cold index of a reused checkout copy
  under a given graph project id; writes the normalised dump, the CLI
  report and `/usr/bin/time -v`.
- [normalise.mjs](normalise.mjs): an order-free dump of a store with ids
  replaced by the keys they stand for.
- [runs.sh](runs.sh): N cold runs of one pin; `VARY=1` gives every run its
  own project id.
- [same.mjs](same.mjs): byte comparison of dumps, with differing lines.
- [permute.mjs](permute.mjs): re-runs the Rust resolve phase of a finished
  store on its own inputs in seeded orders (used to find the second
  mechanism on dioxus before the canonical order existed).
- [sweep-after.sh](sweep-after.sh): the standard sweep runner for one build
  into its own scratch folder.
- [union.mjs](union.mjs) and [tables.mjs](tables.mjs): the comparison
  against several main runs and its tables.
- [cost.mjs](cost.mjs), [cost-runs.sh](cost-runs.sh),
  [order-cost.mjs](order-cost.mjs): cost.
- [cargo-check.sh](cargo-check.sh): the Cargo check of the fixtures.

## Reproduce

```sh
bash evidence/c-19/fetch.sh "$PYM_SCRATCH" dioxus https://github.com/DioxusLabs/dioxus.git 97adf7915e1adfef4e2da436c9bd0b6add0dfa39
VARY=1 bash evidence/c-24/runs.sh builds/c24 dioxus proof 1 10
node evidence/c-24/same.mjs out/dioxus-proof-*.dump.gz
MANIFEST=evidence/c-24/rust-pins-18.json bash evidence/c-24/sweep-after.sh - main main1   # and main2, main3, c24
node evidence/c-24/union.mjs final.json sw/c24.json sw/main1.json sw/main2.json sw/main3.json
node evidence/c-24/tables.mjs final.json item1.json item2.json item3.json
```
