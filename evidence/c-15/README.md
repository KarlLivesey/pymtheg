# C-15 evidence

All runs used the dev server, on memory-backed scratch, with the sweep runner
(`scripts/sweep/run.mjs --local-build`). Main is `5ec4baa` (C-8 merged);
"diagnostic" is main with the resolver's failed-file set forced empty, used
only to bound what a failed file can withhold (not committed).

## Files

- [`affected.json`](affected.json): the five repositories with Rust failed
  files (vercel/turborepo is a TypeScript pin with a large Rust workspace;
  the plan's Rust section counts its Rust links).
- [`rust-pins.json`](rust-pins.json): the 20 Rust pins.
- [`compare.mjs`](compare.mjs): compares two runs link by link (outcome,
  target, candidates, library rows, symbol keys) and writes every changed
  site, plus every reason-only change ordered by a fixed-seed hash (`c15`).
- [`cross-check.mjs`](cross-check.mjs): every link whose failed-file reason
  this branch drops, against its outcome in the diagnostic build.
- [`compare-summary.json`](compare-summary.json): main against this branch.
- [`oracle-summary.json`](oracle-summary.json): main against the diagnostic
  build.
- [`audit.md`](audit.md), [`audit-sample.json`](audit-sample.json): the hand
  audit.
- [`merge-exports.mjs`](merge-exports.mjs), [`plan.mjs`](plan.mjs): join
  the `coverage-export.mjs` outputs of one build and regenerate only the
  plan's Rust section; [`coverage-plan-input.json.gz`](coverage-plan-input.json.gz)
  is the Rust input it wrote for this branch. `plan.mjs` with C-10's input
  reproduces main's Rust section byte for byte.
- [`cost.sh`](cost.sh): the cost observation.
- [`embassy-main-twice.json`](embassy-main-twice.json): two runs of main on
  embassy, compared.

## Runs

1. Main and the diagnostic build on the five affected repositories; this
   branch (before the merge of main) on the same five, then on the 15 other
   Rust pins at the same time as main. swc runs out of memory in
   TypeScript analysis on main after 46 minutes and was stopped on the
   branch; it has no comparison.
2. `compare.mjs` main → branch and main → diagnostic;
   `cross-check.mjs` on the dropped reasons against all diagnostic changes.
3. After merging main (C-11, no Rust module file changed): alacritty, mdBook
   and rustls re-run with the merged build; their Rust links are identical
   to the pre-merge candidate (mdBook's TypeScript links change, from C-11).
4. `coverage-export.mjs` for both builds, `merge-exports.mjs`, `plan.mjs`,
   `coverage.mjs --plan`.

## Results

| Repository | Rust links | Definite kept | Level 2 main → branch | Failed-file label main → branch | Diagnostic build releases |
| --- | ---: | --- | --- | --- | ---: |
| vercel/turborepo | 683,584 | 219,469 / 219,469 | 42.45% → 42.45% | 280,527 → 125,084 | 408 |
| DioxusLabs/dioxus | 149,592 | 51,040 / 51,040 | 42.18% → 42.18% | 13,298 → 4,570 | 44 |
| rustls/rustls | 69,929 | 17,183 / 17,183 | 27.13% → 27.13% | 18,141 → 7,641 | 10 |
| alacritty/alacritty | 30,965 | 11,397 / 11,397 | 44.73% → 44.73% | 11,222 → 3,586 | 1 |
| rust-lang/mdBook | 12,557 | 4,837 / 4,837 | 49.15% → 49.15% | 347 → 223 | 5 |
| 14 other Rust pins | 683,975 | 226,242 / 226,242 | unchanged | none | — |
| embassy-rs/embassy | 514,539 | see below | 31.77% → 31.77% | none | — |

On every compared pin the symbol keys, link sites, candidate sets and
library rows are identical, and on all but embassy no link changes outcome.
Of 182,431 dropped reasons, 0 change outcome in the diagnostic build.

Rust Level 2 in the regenerated plan: 38.88% → 38.88%. The plan's
`rust-taint` row: 283,322 → 110,623 exact Level 2 misses.

Embassy: 4 definite imports become unresolved and 4 unresolved ones
definite, all `use super::…` or `use crate::…` imports in cfg-alternative
sibling files (`platform/spin.rs` and `std.rs`, `ppi/ppi.rs` and
`dppi.rs`, `time_driver/tim.rs` and `lptim.rs`, `rcc/u3.rs` and `u5.rs`).
Embassy has one failed file, which is not placed in any crate, and no link
carries the failed-file reason on either build, so no changed code path runs.
Two runs of main differ the same way (7 definite imports, same files:
[`embassy-main-twice.json`](embassy-main-twice.json)): main resolves these
imports nondeterministically. That is a defect of its own, outside this chunk.

## Cost

Cold `graph index`, memory-backed scratch, one session, main twice and the
branch between them. Wall time on the shared server is not compared.

| Repository | Measure | Main | Branch |
| --- | --- | ---: | ---: |
| alacritty | user CPU s | 36.12 / 34.12 | 37.43 |
| alacritty | peak RSS KiB | 729,428 / 756,816 | 742,480 |
| rustls | user CPU s | 137.88 / 137.70 | 139.07 |
| rustls | peak RSS KiB | 1,387,068 / 1,422,788 | 1,442,260 |
