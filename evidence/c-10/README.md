# C-10 evidence

All runs used the dev server and the pins in [`affected.json`](affected.json)
(ten Rust repositories, including serde and clap with heavy macros and
crossbeam, ratatui and helix with many traits). Main is `efa0e9e`. The
sweep runner (`scripts/sweep/run.mjs --local-build`) indexed each pin with a
build of main and with this branch, in one scratch folder.

## Files

- [`compare.mjs`](compare.mjs): compares every stored link and symbol key of
  two runs. Sites are keyed by module, file, kind, range and target name;
  symbols by module, file, kind, identity and ordinal. It writes the summary
  and the fixed-seed sample (seed `c10`, lowest hashes per mechanism).
- [`compare-summary.json`](compare-summary.json): per repository, symbol and
  link counts, definite links kept and changed, library and candidate-set
  changes, newly definite links by mechanism, and unresolved method calls by
  receiver gap.
- [`hand-check.md`](hand-check.md), [`hand-check-sample.json`](hand-check-sample.json):
  100 newly definite links read against the pinned source.
- [`scoreboard-before.md`](scoreboard-before.md), [`scoreboard-after.md`](scoreboard-after.md):
  `coverage.mjs` over the SW-3 base with main's plan inputs (C-1, C-4) and the
  main or C-10 ten-pin export.
- [`coverage-plan-input.json.gz`](coverage-plan-input.json.gz): the merged
  input for the plan's Rust section; [`merge-coverage.mjs`](merge-coverage.mjs)
  merges exports (later inputs win per repository).
- [`timing.json`](timing.json): the three pins used for the cost runs.

## Results

All ten pins finished (clap is `incomplete` with the same failed files on
both builds). Over all ten:

- links definite on main: 121,173, all kept with the same target;
- symbol keys: 0 removed, 0 added; link sites: 482,682 on both builds, none
  only on one side;
- library links and candidate sets: unchanged;
- newly definite: 30,809 local references, 10,342 generic-parameter
  references, 1,448 method calls on inferred receivers and 10 on written
  receivers (the autoref step).

| Repository | Level 2 main | Level 2 C-10 | Raw Rust resolved main | Raw C-10 |
| --- | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | 41.68% | 53.10% | 35.10% | 46.51% |
| cberner/redb | 29.04% | 39.29% | 25.04% | 35.29% |
| clap-rs/clap | 26.96% | 32.63% | 21.85% | 27.52% |
| crossbeam-rs/crossbeam | 31.29% | 47.90% | 22.63% | 39.31% |
| fjall-rs/fjall | 35.99% | 44.54% | 22.37% | 30.95% |
| helix-editor/helix | 33.23% | 41.75% | 26.45% | 34.99% |
| ratatui/ratatui | 31.34% | 39.47% | 27.19% | 35.32% |
| serde-rs/serde | 36.47% | 44.61% | 17.27% | 25.42% |
| tokio-rs/axum | 35.18% | 43.44% | 21.71% | 29.98% |
| tree-sitter/tree-sitter | 33.72% | 39.22% | 23.04% | 29.09% |

Rust Level 2 over the 19 finished pins: 31.90% (main, which reproduces the
current plan) → 34.57%. Sites are identical, so the like-for-like figure is
the same. In the plan, `rust-value` reads 34/83 reference sites settled and
`rust-parameter` 12/21.

A first candidate build linked more locals; its sample review found that an
identifier in a pattern can be a constant or unit variant, and the older
tests found further gaps (hidden standard methods, generated traits, failed
files, signature references). The second build closes them; all figures
here are from it.

## Hand-check

Of the 100 sampled links, 30 are local references, 30 generic parameters and
40 method calls (the brief asks for 30 method links). Each was read back to
the binding or declaration; for methods, to the receiver's written type, the
impl, and the traits in scope. All 100 are correct. The corpus is not built,
so rustc did not confirm them; the fixtures under
`test/fixtures/rust-c10/` pass `cargo check --all-targets` with and without
their features, and their negative cases are written so that they only
type-check if rustc selects the trait method.

## Receiver gaps

Unresolved method calls on the ten pins, by recorded reason (method links
without a receiver recipe are `no-recipe`; written receiver types that the
lookup still cannot close are `written-type`):

| Gap | Calls |
| --- | ---: |
| no-recipe | 31,924 |
| callee-unresolved | 29,677 |
| receiver-method-unresolved | 11,670 |
| written-type | 10,171 |
| pattern-binding | 4,564 |
| destructured | 4,534 |
| closure-parameter | 4,025 |
| outside-type (proven library type) | 2,856 |
| macro | 2,264 |
| literal | 1,955 |
| annotation-shape | 1,819 |
| iterator-item | 1,654 |
| index | 1,565 |
| field-owner | 1,483 |
| generic-call | 1,211 |
| other (31 smaller reasons) | 6,900 |

## Cost

Cold `graph index` of the same checkout copy, main and C-10 alternated
(main, C-10, main, C-10) in one session on the dev server, timed with GNU
`time`. Other builders' sweeps shared the machine (one-minute load 27–48),
so wall time swung up to 2× between identical runs and is not compared;
CPU time and peak memory are. Observations, not limits.

| Repository | User CPU s, main | User CPU s, C-10 | User+system s, main | User+system s, C-10 | Peak RSS MiB, main | Peak RSS MiB, C-10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | 35.15 / 35.08 | 39.27 / 40.55 | 78.3 / 68.8 | 86.4 / 71.5 | 747 / 720 | 758 / 747 |
| serde-rs/serde | 45.92 / 48.98 | 48.84 / 52.66 | 74.3 / 72.7 | 75.4 / 74.8 | 884 / 826 | 957 / 812 |
| helix-editor/helix | 93.20 / 90.47 | 101.52 / 92.12 | 164.7 / 191.0 | 203.9 / 189.9 | 1,095 / 1,268 | 1,080 / 1,173 |

Mean user CPU rises 13.7% on ripgrep, 7.0% on serde and 5.4% on helix;
user plus system time 7.3%, 2.2% and 10.7%. Mean peak memory changes by
+2.6%, +3.4% and −4.7%, within the runs' own spread. The added work is
the binding lookups for local references and the receiver recipes, which
the resolver evaluates once per site and place with C-1's memoised lookups.
An earlier attempt using the sweep runner's wall times on all ten pins was
discarded: its two main runs differed by up to 3×.
