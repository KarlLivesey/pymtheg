# C-9 Rust library paths evidence

Across the 18 finished Rust pins, Level 2 went from **33.53% to 32.13%**
on all sites and from **33.53% to 32.52%** on the sites already on main.
The candidate stored 78,048 named library links and preserved all 226,248
prior definite Rust checkout links and 223,849 receiver-call decisions.
[Coverage and preservation](coverage.md) · [Withheld sites before and after the module import rule](withheld.md)

## Checks

The dev-server build, `tsc --noEmit`, and `npm run format:check` passed.
All 3,016 tests in `npm test` and all 17 sweep-tool tests passed. The Cargo
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

The module-import fixture also passed `cargo check --offline --jobs 2
--example module_use`. With both `conflict` and `prefix-conflict` enabled,
rustc exited 101. It reported E0255 for a macro-generated `HashMap` that
conflicts with the type import and E0659 for a macro-generated `std` module
that conflicts with the extern-prelude name during import resolution.
[Module fixture](../../test/fixtures/graph-rust-library/examples/module_use.rs)

## Graph queries

The first two queries ran on the pinned ripgrep checkout `178cc027`.
The result limit applies to displayed links. The counts cover the whole graph.

```text
$ pymtheg graph uses serde Serialize --no-sync --limit 1
Graph uses: ok
Uses of library "serde" symbol "Serialize" (outside this project): {"library":18,"candidateSet":0}

$ pymtheg graph uses std collections::HashMap --no-sync --limit 1
Graph uses: ok
Uses of library "std" symbol "collections::HashMap" (outside this project): {"library":16,"candidateSet":0}
```

On cortex-m `b79801ce`, the `core` query includes the imports in the
register modules. On Serde `e306b0c7`, the Syn query includes the import
at `serde_derive/src/lib.rs:80` and both invocations.

```text
$ pymtheg graph uses core 'arch::asm!' --no-sync --limit 1
Graph uses: ok
Uses of library "core" symbol "arch::asm!" (outside this project): {"library":23,"candidateSet":0}

$ pymtheg graph uses syn 'parse_macro_input!' --no-sync --limit 1
Graph uses: ok
Uses of library "syn" symbol "parse_macro_input!" (outside this project): {"library":3,"candidateSet":0}
```

The pinned RustCrypto import at `sha1/src/compress/loongarch64_asm.rs:4`
uses the same spelling. Its `mod loongarch64_asm` declaration is inside
`cfg_if!`, so the graph lacks placement proof for that file. The indexed
fixture isolates the import syntax, and cortex-m supplies the corpus query
where module placement is proven. [RustCrypto module declaration](https://github.com/RustCrypto/hashes/blob/c50eeb468b26629bbd1177620733a32a084d6f86/sha1/src/compress.rs#L30-L32)

## Source audit

All 30 sampled targets, five from each of six pins, matched their written
binding and the public API at the recorded path. [Audit table](audit.md)

## Cold index observations

The dev-server run used fresh checkouts on the same scratch storage. It ran
main, the candidate and main again for each pin.

| Pin | Main 1 seconds / peak KiB | Candidate seconds / peak KiB | Main 2 seconds / peak KiB | Stored library links |
| --- | ---: | ---: | ---: | ---: |
| rust-lang/mdBook | 166.74 / 574,080 | 164.61 / 579,536 | 145.73 / 552,436 | 2,135 |
| rust-embedded/cortex-m | 120.59 / 287,532 | 143.01 / 276,676 | 120.23 / 288,384 | 581 |

Both main runs and the candidate report an incomplete mdBook index because of
its existing failed sources. The numbers are the numeric rows from GNU time
after its exit-status message. The candidate's mdBook peak is 1.0% above the
higher main observation, with elapsed time inside the two observations.
Cortex-m took 22.42 seconds longer than the slower main run, an 18.6%
increase. The extra resolver pass checks scoped imports, namespaces,
associated owners and Cargo source facts. It produced 553 named library
links and 28 whole-crate links on that pin. The candidate's peak RSS was
4.1% below the higher main observation. Wall time measures the complete
index, including shared-host I/O, so these runs do not isolate resolver time.

## Reproduction

The review comparison starts at main `6b3cdf2`. Both runs use the 18 Rust pins that
finished after C-1. Embassy and swc exceeded the earlier budget. The sweep
records the resolved pin before starting its cold and warm index runs.

The final macro namespace fix changed eight candidate graphs. Exact replay
against the final build identified the affected pins. A fresh sweep rebuilt
Actix and Serde. The other six ran `graph index` on copies of their captured
graphs. Replay matched the stored library decisions on the remaining ten
and on all eight refreshed graphs. The final built package digest is
`10bb2b9e20fd2c483774cd9f57d37985bed6919a94ead5ed430c4cdc750935d8`.

Build both revisions, then run `scripts/sweep/run.mjs --local-build` against
the Rust pin subset. Save the built packages as `main-build` and
`candidate-build` in `$PYM_SCRATCH` and write `main-run.json` and
`candidate-run.json` there. The metadata reader expects `typescript` beside
each package, so link it from the build's installed dependencies into
scratch. Export both with `scripts/sweep/coverage-export.mjs`, the matching
`--metadata-root`, `--reference-samples evidence/sw-3/samples.json.gz`, and
`--shared-with` pointing to the other run. For the candidate also supply
`--sampling-base evidence/sw-3/breakdown.json.gz`. Run
`scripts/sweep/coverage.mjs` with the candidate export and
`--base evidence/sw-3/breakdown.json.gz` to compare with SW-3. For the
published plan, `node evidence/c-9/plan-input.mjs` layers the retained C-4
and C-7 reports in main's order. The latter includes C-1's Rust records.
The script then refreshes the Rust pins from the candidate. Pass its
`plan-base.json` and `plan-candidate.json` to the same generator with
`--plan docs/coverage-plan.md`. The Rust pin refresh contributes the Go and
TypeScript links that also occur in those checkouts.

`node evidence/c-9/compare.mjs` compares every prior definite checkout link
and every prior symbol key using stable file, syntax and symbol identities.
It compares every receiver-call resolution and candidate set independently.
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

`node evidence/c-9/withheld.mjs` replays the Rust resolver over captured
facts in the candidate stores. It checks that the replay reproduces the
stored library decisions. It then counts the first blocker per site with
and without the explicit module import rule, using other review fixes in
both passes. It counts sites with a recognizable outside anchor from a
relaxed probe. Those spellings contribute only to the audit. The
`--verify-only` option compares stored library decisions without the probe.
[Replay script](withheld.mjs)
