# C-9 Rust library paths evidence

Across the 18 finished Rust pins, Level 2 went from **33.53% to 31.47%**
on all sites and from **33.53% to 31.86%** on the sites already on main.
The candidate stored 71,817 named library links and preserved all 226,248
prior definite Rust checkout links. [Coverage and preservation](coverage.md)

## Checks

The dev-server build, `tsc --noEmit`, and `npm run format:check` passed.
All 3,005 tests in `npm test` and all 17 sweep-tool tests passed. The Cargo
context test checks that a cached call switches from a checkout symbol to a
library target when the manifest replaces its local dependency with a registry
dependency.

The compiler fixture exercises both the original receiver calls and the
associated paths from the SW-3 review. The latter use local traits to make
`Path::into`, `State1600::iter` and `RopeSlice::starts_with` valid source.
`thiserror::Error` and the local `enum Error` occupy separate namespaces.
The fixture also has two nested imports named `query` in different
namespaces. The value call selects the outer import in Rust. The graph
withholds a library target when it cannot establish the import's namespace.

`cargo check --offline --jobs 2` passed on the dev server with Keccak 0.2.2,
Ropey 1.6.1 and thiserror 2.0.21. The fixture was copied into scratch before
adding the lockfile and compiling. [Compiler fixture](../../test/fixtures/graph-rust-library/src/lib.rs)

## Graph queries

Both queries ran on the pinned ripgrep checkout `178cc027`. The result limit
applies to displayed links. The counts cover the whole graph.

```text
$ pymtheg graph uses serde Serialize --no-sync --limit 1
Graph uses: ok
Uses of library "serde" symbol "Serialize" (outside this project): {"library":18,"candidateSet":0}

$ pymtheg graph uses std collections::HashMap --no-sync --limit 1
Graph uses: ok
Uses of library "std" symbol "collections::HashMap" (outside this project): {"library":16,"candidateSet":0}
```

The first `serde` result is the trait at `crates/printer/src/jsont.rs:119`
with `qualified-path` evidence and version `1.0.229` from `Cargo.lock`. The
first `HashMap` result is a type reference at
`crates/globset/src/serde_impl.rs:87` with `import-binding` evidence.

## Source audit

All 30 sampled targets, five from each of six pins, matched their written
binding and the public API at the recorded path. [Audit table](audit.md)

## Cold index observations

The dev-server run used fresh checkouts on the same scratch storage. It ran
main, the candidate and main again for each pin.

| Pin | Main 1 seconds / peak KiB | Candidate seconds / peak KiB | Main 2 seconds / peak KiB | Stored library links |
| --- | ---: | ---: | ---: | ---: |
| rust-lang/mdBook | 78.75 / 566,652 | 76.32 / 582,284 | 107.04 / 569,328 | 2,156 |
| rust-embedded/cortex-m | 103.05 / 286,012 | 77.54 / 312,460 | 49.33 / 321,400 | 602 |

Both main runs and the candidate report an incomplete mdBook index because of
its existing failed sources. The numbers are the numeric rows from GNU time
after its exit-status message. The candidate's mdBook peak is 2.3% above the
higher main observation. Cortex-m's candidate time and memory both fall
inside the main observations.

## Reproduction

The comparison starts at main `efa0e9e`. Both runs use the 18 Rust pins that
finished after C-1. Embassy and swc exceeded the earlier budget. The sweep
records the resolved pin before starting its cold and warm index runs.

Build both revisions, then run `scripts/sweep/run.mjs --local-build` against
the Rust pin subset. Save the built packages as `main-build` and
`candidate-build` in `$PYM_SCRATCH` and write `main-run.json` and
`candidate-run.json` there. The metadata reader expects `typescript` beside
each package, so link it from the build's installed dependencies into
scratch. Export both with `scripts/sweep/coverage-export.mjs`, the matching
`--metadata-root`, and `--reference-samples evidence/sw-3/samples.json.gz`.
For the candidate also supply `--shared-with "$PYM_SCRATCH/main-run.json"`
and `--sampling-base evidence/sw-3/breakdown.json.gz`. Run
`scripts/sweep/coverage.mjs` with the candidate export and
`--base evidence/sw-3/breakdown.json.gz` to compare with SW-3. For the
published plan, `node evidence/c-9/plan-input.mjs` layers the retained C-4
and C-1 reports in main's order and refreshes the Rust pins. Pass its
`plan-base.json` and `plan-candidate.json` to the same generator with
`--plan docs/coverage-plan.md`. The Rust pin refresh contributes the Go and
TypeScript links that also occur in those checkouts.

`node evidence/c-9/compare.mjs` compares every prior definite checkout link
and every prior symbol key using stable file, syntax and symbol identities.
It also draws five distinct named library sites from each of the six audit
repositories. Within each repository it ranks the fixed-seed SHA-256 of
repository, file, span, unit and symbol. The source line comes from the pinned
file in the sweep checkout. [Comparison and draw](compare.mjs)

`node evidence/c-9/bench.mjs REPO REPO` puts the main, candidate and repeated
main cold runs on the same storage and measures their elapsed time and peak
RSS. Each run starts with a fresh checkout and graph store.
[Cold measurements](bench.mjs)

`node evidence/c-9/metrics.mjs` summarizes `main-coverage.json` and
`candidate-coverage.json` from the exports. [Metric calculation](metrics.mjs)
