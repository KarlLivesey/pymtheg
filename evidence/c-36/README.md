# Rust edit-proportional re-index evidence

[Change note](../../docs/changes/C-36.md)

Main is `db29fc7`. All runs used the dev server with Node 24, source-only, on
the pinned checkouts of `sweep/repos.json`. Timings are observations on a
shared server; the work counts are the comparison.

- [Edit measurements](edits.json) hold one row per `graph index` from
  `scripts/reindex/measure.mjs`: CPU seconds, the number of Rust files whose
  links were decided, whether the scoped path ran, the full-pass reason and
  the CPU of the Rust analysis and resolution stages. Every revert row
  equalled that build's cold store.
- [Probe](probe.json) records the lookup cuts in a cold index of each pin and
  the cost and cuts of one full pass against passes that decide one sampled
  file. The samples rank paths by SHA-256 of `c36-probe:<path>`.
- [Seeded edits](seeded.json) list every seeded step: file, kind, whether the
  incremental store equalled a fresh cold index, the files decided, the
  path taken and the verified no-edit run after it.
- [Cold comparison](cold.json) records the cold runs main, after, main on
  four pins with every row compared with the first run.
- [Checks](checks.json) records the build, type, format and test results.
