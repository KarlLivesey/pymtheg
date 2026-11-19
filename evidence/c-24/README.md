# C-24 evidence: Rust determinism, unlocked facades, inherent impl crates

[Change note](../../docs/changes/C-24.md). Everything here ran on the dev
server with the pinned toolchains; scratch paths are under `$PYM_SCRATCH`.
Pins: `rust-pins.json` (the 19 Rust sweep pins without swc) and
`rust-pins-18.json` (the 18 coverage pins: those without embassy).

## Builds

- `main`: `origin/main` at `e7585f2`, `npm run build`.
- `c24`: this branch (`npx tsc` over the same build).
- `items-1`, `items-12`: the branch build with later items switched off
  in its compiled Rust module, for per-item attribution
  ([item-builds.mjs](item-builds.mjs); every replacement must match
  exactly once). `items-1` is determinism only; `items-12` adds the
  unlocked-facade rule; `c24` adds the inherent-impl rule.

## Scripts

- [index-run.mjs](index-run.mjs): one cold index of a reused checkout copy
  under a given graph project id; writes the normalised dump
  ([normalise.mjs](normalise.mjs)), the CLI report and `/usr/bin/time -v`.
- [normalise.mjs](normalise.mjs): an order-free dump of a store: every
  symbol, link (outcome, target, stored data), candidate and library row,
  with store ids replaced by the keys they stand for.
- [runs.sh](runs.sh): N cold runs of one pin; `VARY=1` gives every run its
  own project id, as separate `pymtheg init` runs do.
- [same.mjs](same.mjs): byte comparison of dumps, with the differing lines.
- [permute.mjs](permute.mjs): re-runs the Rust resolve phase of a finished
  store on its own inputs in seeded random orders and prints a digest of
  the answers keyed by content.
- [sweep-after.sh](sweep-after.sh): the standard sweep runner
  (`scripts/sweep/run.mjs --local-build`) for one build into its own
  scratch folder.
- [union.mjs](union.mjs): site-by-site comparison of a candidate sweep
  with several main sweeps (C-12 comparator's site key and decision,
  mark-aware), lost links against the union of main, newly definite
  links, per-pin Level 2 and the fixed-seed audit draw.
- [cargo-check.sh](cargo-check.sh) → [cargo-check.txt](cargo-check.txt):
  Cargo's own resolution of the item-2 fixtures without a lockfile.

## Reproduce

```sh
# fetch the pins as C-19 does
bash evidence/c-19/fetch.sh "$PYM_SCRATCH" NAME URL SHA
# 10 cold runs, each with its own project id, then compare
VARY=1 bash evidence/c-24/runs.sh builds/c24 dioxus proof 1 10
node evidence/c-24/same.mjs out/dioxus-proof-*.dump.gz
# sweeps (main three times, each item build once)
MANIFEST=evidence/c-24/rust-pins-18.json bash evidence/c-24/sweep-after.sh - main main1
node evidence/c-24/union.mjs union.json sw/c24.json sw/main1.json sw/main2.json sw/main3.json
```
