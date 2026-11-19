# C-10 evidence

All runs used the dev server. The final runs compare main `4766795` (C-9
merged) with this branch after both reviews, on memory-backed scratch. The
sweep runner (`scripts/sweep/run.mjs --local-build`) indexed every pin with
each build.

## Files

- [`compare.mjs`](compare.mjs): compares every stored link and symbol key of
  two runs. Sites are keyed by module, file, kind, range and target name;
  symbols by module, file, kind, identity and ordinal. It also compares every
  library-target row and the outcome of every call whose receiver has a
  proven library type, and draws a fixed-seed sample (seed `c10`).
- [`compare-summary.json`](compare-summary.json): the final comparison on
  [`compare-pins.json`](compare-pins.json) (ripgrep, serde and clap with heavy
  macros, crossbeam and helix with many traits).
- [`hand-check.md`](hand-check.md), [`hand-check-sample.json`](hand-check-sample.json):
  100 newly definite links read against the pinned source (second build).
- [`scoreboard-before.md`](scoreboard-before.md), [`scoreboard-after.md`](scoreboard-after.md):
  `coverage.mjs` with main's or this branch's 18-pin export, layered by
  `evidence/c-9/plan-input.mjs`.
- [`coverage-plan-input.json.gz`](coverage-plan-input.json.gz): the plan
  input (`plan-candidate.json` from `plan-input.mjs` with this branch's
  export of [`rust-pins.json`](rust-pins.json)).
- [`affected.json`](affected.json), [`timing.json`](timing.json): the pins of
  the first-round runs below; [`merge-coverage.mjs`](merge-coverage.mjs): the
  first-round plan merge.

## Results against main with C-9

Five pins, every link compared:

- links definite on main: 60,622, all kept with the same target;
- library-target rows: identical on all 24,846 links that have them;
- symbol keys: 0 removed, 0 added; link sites: 247,950 on both builds;
- candidate sets: unchanged; calls on a proven library receiver type
  (1,631): outcome unchanged;
- newly definite: 15,673 local references, 5,555 generic-parameter
  references, 896 method calls.

Level 2 on the 18 finished Rust pins (same link counts on both builds):

| Pin | Links | Level 2 main | Level 2 C-10 |
| --- | ---: | ---: | ---: |
| BurntSushi/ripgrep | 39,819 | 53.97% | 64.74% |
| DioxusLabs/dioxus | 153,841 | 34.09% | 42.06% |
| RustCrypto/hashes | 12,911 | 32.44% | 45.28% |
| actix/actix-web | 86,640 | 29.26% | 36.26% |
| alacritty/alacritty | 30,965 | 35.62% | 44.73% |
| cberner/redb | 73,731 | 30.96% | 40.99% |
| clap-rs/clap | 52,417 | 30.08% | 35.68% |
| crossbeam-rs/crossbeam | 34,220 | 34.48% | 51.04% |
| fjall-rs/fjall | 13,401 | 36.76% | 44.25% |
| helix-editor/helix | 90,780 | 33.64% | 41.11% |
| ratatui/ratatui | 60,424 | 28.68% | 36.25% |
| rust-embedded/cortex-m | 5,531 | 48.89% | 54.62% |
| rust-lang/mdBook | 20,253 | 28.56% | 34.42% |
| rustls/rustls | 69,929 | 22.42% | 27.13% |
| serde-rs/serde | 30,714 | 19.00% | 26.96% |
| tauri-apps/tauri | 93,514 | 37.36% | 44.68% |
| tokio-rs/axum | 41,099 | 27.12% | 35.18% |
| tree-sitter/tree-sitter | 59,932 | 33.44% | 38.83% |

Rust Level 2 in the plan: **31.10% → 35.80%**. Sites are identical, so the
like-for-like figure is the same. Main's export, layered the same way,
reproduces main's plan byte for byte.

## Hand-check

Of the 100 sampled links (second build), 30 are local references, 30
generic parameters and 40 method calls. Each was read back to the binding or
declaration; for methods, to the receiver's written type, the impl, and the
traits in scope. All 100 are correct. The two reviews checked 85 and 126
more. The corpus is not built, so rustc did not confirm them; the fixtures
under `test/fixtures/rust-c10/` pass `cargo check --all-targets` with and
without their features, and their negative cases only type-check if rustc
selects the other method.

## Receiver gaps (first round, ten pins)

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

Cold `graph index` of the same checkout copy on memory-backed scratch, GNU
`time`. Other builders shared the machine, so wall time is not compared.
Observations, not limits.

| Pin | Measure | Main | C-10 | Change |
| --- | --- | ---: | ---: | ---: |
| cberner/redb | user CPU s (two alternated runs) | 69.00 / 62.57 | 74.49 / 67.75 | +8.1% |
| cberner/redb | peak RSS KiB | 1,079,344 / 1,065,336 | 1,099,772 / 1,078,332 | +1.6% |
| vector (pinned corpus) | peak RSS KiB | 3,734,952 | 3,728,684 | −0.2% |
| vector (pinned corpus) | user CPU s | 442.04 | 474.10 | +7.3% |

The second review measured redb user CPU +25% and Vector peak memory +28%
on the earlier head. A profile of redb found the extra time in repeated
binding lookups in the parser, the conservative recipes built twice, and
receiver typing that missed its memo because every link copies its place.
The changes: binding lookups memoised per node and name; the conservative
facts built only under a macro statement; one path-pattern lookup per
module; receiver typing and path-call lookups keyed by place content;
empty recipe fields not stored. The two Vector runs end `incomplete` (exit
2) on both builds because of the corpus's failed files.

An earlier first-round measurement (ripgrep, serde, helix, before the
reviews) found user CPU +13.7%, +7.0% and +5.4%.
