# Rust edit-proportional re-index evidence

[Change note](../../docs/changes/C-36.md)

All runs used the dev server with Node 24, source-only, on the pinned
checkouts of `sweep/repos.json`. Timings are observations on a shared
server; the work counts and row comparisons are the comparison. After the
review, main is `5d97762` (with C-24, C-35 and C-26) and the candidate is
this branch. Before the review, main was `db29fc7`.

- [Edit measurements](edits.json) hold one row per `graph index` from
  `scripts/reindex/measure.mjs` after the review fixes. Each row gives CPU
  seconds, the Rust files whose links were decided, whether the scoped path
  ran, the full-pass reason and the CPU of the Rust stages. Every revert row
  equalled that build's cold store.
  [Before the review](edits-before-review.json) holds the same rows for
  `d96a8ba`.
- [Ten-pin comparison](ten-pins.json) compares every Rust link of ten cold
  pins between main and the candidate with `evidence/c-31/compare.mjs`:
  definite targets lost or retargeted (`changes`), new definite links,
  Level 2 counts and symbol identities.
- [Cold comparison](cold.json) records cold runs main, after, main on four
  pins with every row compared with the first run. File records carry the
  module version, so the comparison maps Rust version 47 back to 46
  (`cold-cost.mjs --rust-version 47=46`). [Before the review](cold-before-review.json).
- [Seeded edits, first batch](seeded-review.json) and
  [second batch](seeded-review-2.json) list every seeded step after the
  review fixes. Each step records its file and kind, whether the
  incremental store equalled a fresh cold index, the files decided, the
  path taken and the verified no-edit run after it. Both batches used
  `--scoped-mix`; the second used the reweighted mix.
  [The batch at d96a8ba](seeded.json) used the default mix.
- Round 2, after the cost fix:
  [dioxus cold, two rounds](cold-dioxus.json),
  [helix, redb and embassy cold](cold-round2.json) with
  [embassy's second main run](cold-embassy-main2.json), which was repeated
  for timing alone after the harness ran out of memory comparing it.
  [Eight pins' rows](rows-eight-pins.json) come from parallel runs that are
  not cost evidence. [Dioxus edits](edits-dioxus.json) and the
  [clap seeded batch](seeded-clap.json) complete the round. The
  [ten-pin comparison](ten-pins.json) is from this round, while
  [cold.json](cold.json) was measured before the cost fix.
- [Tests at the reviewed head](reviewed-head-tests.txt) show the new tests
  run against a build of `d96a8ba`.
- [Probe](probe.json) records the lookup cuts in a cold index of each pin
  before the review, and the cost and cuts of one full pass against passes
  that decide one sampled file. The samples rank paths by SHA-256 of
  `c36-probe:<path>`.
- [Checks](checks.json) records the build, type, format and test results.
