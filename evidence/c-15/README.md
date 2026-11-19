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

RESULTS
