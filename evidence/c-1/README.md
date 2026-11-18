# C-1 Rust corpus completion

[Validation after merging PR 9](merged-validation.md)

## What stalled

The dev server ran Node 24.21.0 against the pins in `sweep/repos.json`. The
Serde profile started with the public `pymtheg@0.1.0` process and captured
ten more seconds after `graph analyze rust: 0/208`. Of the 9.58 seconds
sampled with the Rust resolver on the stack, 9.19 seconds had recursive
path lookup on the stack. The deepest sample contained 45 path-lookup
frames. [Profile summary](serde-profile.json)

A separate counter probe stopped after 300,000 calls to `find`. The calls
covered 446 distinct file, scope, spelling and namespace combinations. The
existing guards made 17,824 cuts, including 127 growing import suffixes and
zero depth cuts. The busiest spelling was `crate::lib` in
`serde_core/src/de/mod.rs`. At one sample the root was looking for
`MapAccess` in a guessed placement of `serde/src/private/de.rs` under
`serde_derive_internals`. The conditional `internals` module layout and
its glob re-export feed uncertain module alternatives into other glob and
explicit-import lookups. The cycle check only stops a currently active
branch. Later branches restarted the same incomplete lookup.
[Serde conditional module and re-export](https://github.com/serde-rs/serde/blob/e306b0c7c40ad21d5bdf52bcd20da513904682ae/serde_derive_internals/lib.rs#L50-L54)
· [Serde conditional imports](https://github.com/serde-rs/serde/blob/e306b0c7c40ad21d5bdf52bcd20da513904682ae/serde/src/private/de.rs#L213-L220)

An initial memo keyed by the entire active path did little to help. After
six million calls in the Serde probe it had replayed 107,944 incomplete
answers and computed 5,086,514 uncached searches. The final memo records
which ancestor checks affect a lookup, so different branches can share an
answer when the relevant checks agree. It retains the existing incomplete
answer, including target hints and reasons. The synthetic fixture uses 22
layers of overlapping glob re-exports plus an unavailable dependency name.
[Regression tests](../../test/graph-rust-finishing.test.mjs)

Rustls spent 4.71 seconds of a five-second worker profile under
`textualMacro` after the path memo was in place. Its API test root had
244,628 unseen textual macro entries with 786 distinct records. The
alternatively placed modules repeatedly contributed the same uncertainty
for the same position and conditions. The per-file index keeps the first
copy of an identical unseen record along with every distinct record.
[Rustls profile](rustls-profile.json)
· [Rustls test module layouts](https://github.com/rustls/rustls/blob/53db4d1398f16d5bac98eacf02f0dff4b242fd92/rustls-test/tests/api.rs#L1-L71)

The Dioxus worker profile put 6.48 seconds under `helperShadowed → find`
while checking visibility of the `error` derive helper. That lookup runs
before resolving stored links. Reuse now covers these searches and includes
the active helper scope. The memo clears when a helper or opaque scope
changes the available facts. An import whose suffix grows along a cycle
can reuse its incomplete result when the earlier suffix-length check still
cuts the same route.
[Dioxus derive helper](https://github.com/DioxusLabs/dioxus/blob/97adf7915e1adfef4e2da436c9bd0b6add0dfa39/packages/fullstack/src/payloads/websocket.rs#L1458-L1462)

## Cancellation

The regression starts the production graph CLI with an indefinitely CPU-bound
Rust worker. The worker writes a readiness marker. The test sends SIGINT
during analysis and SIGTERM during
resolution, checks exit 130 and then retries the same index successfully.
[Worker fixture](../../test/fixtures/graph-rust/busy-phase.mjs)
· [CLI tests](../../test/graph-rust-finishing.test.mjs)

## Identity on eight finished repositories

All 349,441 stored links and all exported breakdown rows matched the release
rerun. The table reports Level 2 across the whole checkout and cold-index
wall time and peak resident memory as observed on the shared dev server.
The overlapping runs experienced different filesystem load.

| Repository | Links compared | Level 2 before → after | Release time / peak RSS | Candidate time / peak RSS |
| --- | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | 39,086 | 41.6824% → 41.6824% | 58.0 s / 1131 MiB | 64.8 s / 1233 MiB |
| RustCrypto/hashes | 12,870 | 40.6915% → 40.6915% | 63.3 s / 535 MiB | 22.6 s / 638 MiB |
| actix/actix-web | 85,053 | 31.0171% → 31.0171% | 166.0 s / 1992 MiB | 141.8 s / 1917 MiB |
| alacritty/alacritty | 30,052 | 39.3917% → 39.3917% | 77.5 s / 1036 MiB | 46.6 s / 1140 MiB |
| clap-rs/clap | 50,949 | 26.9564% → 26.9564% | 86.3 s / 1293 MiB | 92.9 s / 1336 MiB |
| helix-editor/helix | 86,281 | 33.2263% → 33.2263% | 179.2 s / 1979 MiB | 159.9 s / 2255 MiB |
| rust-embedded/cortex-m | 5,200 | 54.0962% → 54.0962% | 44.4 s / 401 MiB | 12.7 s / 421 MiB |
| tokio-rs/axum | 39,950 | 35.1815% → 35.1815% | 114.8 s / 1204 MiB | 71.0 s / 1312 MiB |

[Link-dump hashes](link-identity.json) · [Breakdown comparison](breakdown-identity.json)

## Previously stalled pins

Cold timings and peak RSS come from the sweep's GNU time measurements. The
release observations and failure stages are from SW-1. Successful CLI runs
with source diagnostics are marked incomplete. Level 2 uses all stored
checkout links.
[Release measurements](../sw-1/summary.md)

| Repository | Candidate outcome | Release cold time / peak RSS | Candidate cold time / peak RSS | Candidate Level 2 |
| --- | --- | ---: | ---: | ---: |
| DioxusLabs/dioxus | Finished, 3 failed source files | 3,607.4 s / ≥1594 MiB | 448.2 s / 3353 MiB | 36.8420% |
| embassy-rs/embassy | Finished, 1 failed source file | 3,606.2 s / ≥3652 MiB | 2,354.6 s / 7881 MiB | 33.7352% |
| rustls/rustls | Finished, 1 failed source file | 3,607.1 s / ≥3970 MiB | 166.9 s / 1998 MiB | 26.9079% |
| serde-rs/serde | Finished, clean | 3,608.8 s / ≥713 MiB | 62.3 s / 1272 MiB | 36.4664% |
| swc-project/swc | Wall limit after Rust analysis | 3,576.1 s / ≥3512 MiB | 3,568.0 s / 5531 MiB | — |

swc captured 1,523 Rust files and 50,158 TypeScript and JavaScript files.
Its Rust pass walked 394,584 links. Samples moved through the densely
imported React compiler conversion modules and on to the native addon.
The CLI reported all 1,523 Rust files analyzed by 57 minutes into cold
indexing. After analysis, 7.51 of 7.74 sampled seconds were inside
`SqliteGraphStore.replaceFile`, mainly executing SQLite link inserts
and transactions. The time limit ended the cold run in this write phase.
A separate 20-minute Rust-only in-memory diagnostic reached its own
limit during analysis, which shows that the scale of the Rust lookup
work also matters. [swc profiles and progress](swc-profile.json)

The SW-3 overlay now has 57 of 60 completed checkouts. Across Rust links,
Level 2 rose from **33.2695% to 33.6029%**. The denominator grew from
678,768 to 1,424,236 links as the four graphs entered the score.

The source audit checked 20 newly available definite links drawn from the
Dioxus, Rustls and Serde graphs. The eight identity graphs established
zero changes at the existing reference sites.
[Fixed-seed source audit](source-audit.md)

## Build and tests

`npm run build`, `tsc --noEmit` and `npm test` passed on the dev server.
All 2,938 tests passed, including both indefinite-worker signal tests,
the derive-helper and glob fixture and the explicit path-depth check.
The corpus export counted zero depth-limit reasons in the measured graphs.
The ten coverage-script tests passed after updating its completion label.
The eight identity pins and the Dioxus, Rustls and Serde cold results use
artifact `ed9acf44919f4e7f2d37c7718b3fac07ae8d05e65a9e8602a128bed7e1c3901f`.
The two large attempts use
`091764e67c30715ac5429f9e4af5c4c383b79ff10cc450cdaeca4198c5e85f36`
from before the final change to keep the Go toolchain cancellation
diagnostic. That change affects interrupted requests only.

## Reproduction

Use the public pins named in the results table. Run the release sweep for the
eight identity checks and the candidate sweep for those eight plus the five
historical stalls. Use the same dev-server scratch directory for the release
install and candidate artifact. Export each run with
`scripts/sweep/coverage-export.mjs --reference-samples evidence/sw-3/samples.json.gz`.
Generate the candidate overlay with `scripts/sweep/coverage.mjs --base
evidence/sw-3/breakdown.json.gz`.

```sh
node evidence/c-1/compare-links.mjs "$PYM_SCRATCH" \
  "$PYM_SCRATCH/baseline-run.json" "$PYM_SCRATCH/final-run.json"
node evidence/c-1/sample-links.mjs "$PYM_SCRATCH" \
  "$PYM_SCRATCH/final-run.json" "$PYM_SCRATCH/stalled.json"
```

The link comparison dumps sorted rows from SQLite. It normalizes project UUIDs
and symbol IDs to module, file, kind, scoped identity and ordinal. The dumps
retain every stored link, its payload, source, target, candidates and
would-be targets, including duplicate rows. The JSON comparison retains the
row counts and the hashes of those dumps. The breakdown comparison uses the
exporter's full tuple rows.
