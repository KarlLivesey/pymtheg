# C-12 Rust macro scope evidence

## Pinned coverage

The original 18 finished Rust pins completed on both builds. The final sweep
compared main `8ca29ac` with the C-10-integrated C-12 build on memory-backed
storage. Each pair used a project ID derived from the pin and a fixed seed,
so both indexes visited the same source sites in the same order. The final
candidate keeps macro-input globs, uncertain item headers, and foreign
declaration blocks opaque. [Change note](../../docs/changes/C-12.md)

Level 2 counts checkout targets and named library targets. Each retry tests
the proven rule first, so excluding sites with `rust-external-macro-name`
from the numerator gives the result for A alone. All three measurements use
the same 947,018 sites. The like-for-like and all-site rates are identical.

| Pin | Sites on main | Main L2 | Proven pass | A+B | Assumed checkout | Assumed library |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | 39,819 | 64.74% | 65.42% | 65.43% | 0 | 1 |
| DioxusLabs/dioxus | 149,592 | 42.18% | 42.18% | 44.15% | 238 | 2,703 |
| RustCrypto/hashes | 12,911 | 45.28% | 45.28% | 46.04% | 18 | 80 |
| actix/actix-web | 86,640 | 36.26% | 36.30% | 39.24% | 309 | 2,233 |
| alacritty/alacritty | 30,965 | 44.73% | 44.95% | 45.47% | 4 | 159 |
| cberner/redb | 73,731 | 40.99% | 41.18% | 41.32% | 12 | 90 |
| clap-rs/clap | 52,417 | 35.68% | 35.74% | 35.82% | 5 | 35 |
| crossbeam-rs/crossbeam | 34,081 | 50.93% | 51.18% | 51.18% | 0 | 0 |
| fjall-rs/fjall | 13,361 | 44.32% | 44.32% | 45.07% | 14 | 87 |
| helix-editor/helix | 90,583 | 41.08% | 41.10% | 43.35% | 700 | 1,341 |
| ratatui/ratatui | 60,424 | 36.25% | 36.26% | 39.19% | 1,386 | 383 |
| rust-embedded/cortex-m | 5,531 | 54.62% | 54.73% | 54.87% | 1 | 7 |
| rust-lang/mdBook | 12,557 | 49.15% | 49.80% | 52.97% | 97 | 302 |
| rustls/rustls | 69,929 | 27.13% | 27.16% | 27.58% | 36 | 263 |
| serde-rs/serde | 30,714 | 26.96% | 26.96% | 26.96% | 0 | 0 |
| tauri-apps/tauri | 88,051 | 43.53% | 43.55% | 47.23% | 501 | 2,745 |
| tokio-rs/axum | 41,067 | 35.19% | 35.20% | 37.72% | 115 | 920 |
| tree-sitter/tree-sitter | 54,645 | 36.32% | 36.33% | 40.38% | 187 | 2,024 |
| **All matched pins** | **947,018** | **40.17%** | **40.25%** | **42.04%** | **3,623** | **13,373** |

The numerators are 380,384 on main, 381,169 with A, and 398,165 with A+B. A
recovers 427 checkout links and 358 named library links. The 16,996 links that
carry the new assumption account for the remaining increase. The comparison
matched all 380,608 existing definite targets and all 223,849 receiver-call
decisions. Every Rust symbol key and link site matched. [Database comparison](compare.mjs)

Before C-10 merged, the same 18 pins scored 32.13%, 32.21%, and 34.01%
respectively. Both comparisons recovered 785 proven and 16,996 assumed
Level 2 links, with the same fixed-seed audit draw.

### Stored unresolved links by primary reason

The table groups the stored Rust diagnostics across checkout and library
references. Each unresolved link contributes to one row. The A-only column
puts links from the assumption-backed retry in their original reason groups.

| Reason | Main | Proven only | A+B |
| --- | ---: | ---: | ---: |
| Opaque macro scope | 182,322 | 181,677 | 166,999 |
| Receiver | 163,377 | 163,377 | 163,377 |
| Lexical or generic binding | 72,226 | 72,226 | 72,226 |
| No recorded reason | 60,442 | 60,310 | 58,317 |
| Competing import, glob or binding | 29,362 | 29,358 | 29,086 |
| Other recorded reason | 28,680 | 28,680 | 28,680 |
| Unread or failed file | 23,198 | 23,194 | 23,141 |
| Cargo edge | 3,945 | 3,945 | 3,945 |
| Item under opaque attribute | 2,061 | 2,061 | 2,061 |

The unread-file row includes the general `failed-file-unseen-declarations`
diagnostic that a checkout lookup can attach when it still has no target.
A retry still needs a complete lookup without a failed-file edge. For
example, the audit's `println!` in Alacritty resolves to the prelude after
the scope check and traverses only readable scopes.

### Named library paths still withheld

This replays the C-9 audit on the same pinned graphs. Each row uses the
primary main diagnostic for a path. The last two columns show how many of
that cohort still lack a target. [Path-audit replay](withheld-library.mjs) · [C-9 reference table](../c-9/withheld.md)

| Main refusal reason | Main | Proven only | A+B |
| --- | ---: | ---: | ---: |
| Opaque macro scope | 94,729 | 94,447 | 81,257 |
| Competing import or glob | 4,979 | 4,979 | 4,979 |
| Cargo edge uncertainty | 1,116 | 1,116 | 1,116 |
| Unknown associated owner | 8,510 | 8,510 | 8,510 |
| Other | 22,818 | 22,818 | 22,818 |

## Soundness checks

`cargo check --offline` accepted the Rust fixture. A macro that supplies a
different item name leaves the ordinary function and prelude type available.
The negative controls emit a same-name function, forward the type name through
a second `macro_rules!` invocation, and generate a `struct` keyword through
an `ident` fragment. That last control reproduces the incorrect standard
`Option` target on module 31. C-12 withholds it. Two further controls show
that omitting a repetition can expose a different item name, and that a
macro inside a foreign block can introduce a declaration into the containing
scope. C-12 withholds both. [Compiler fixture](../../test/fixtures/graph-rust-macro-scope/src/lib.rs)

The final fixed-seed draw matched the twenty proven sites and all sixty
assumption-backed sites across six pins. The assumption-backed draw had zero
failures. [Source and macro output audit](source-audit.md)

## Validation

The full build, type check and format check passed on merged main. The full
`npm test` run passed all 3,062 tests with both `TMPDIR` and `PYM_SCRATCH` on
tmpfs. Scoring the archived 0.1.0 graph data reproduced the committed All
files figures, including 33.27% for Rust and 55.79% overall.
[Committed baseline](../sw-3/scoreboard.md)

## Cold indexing cost

Both snapshots included C-6 and C-10. The three sweeps ran serially in
one tmpfs session with the full test suite idle. Each cell gives cold wall
time and peak RSS.

| Pin | Main `8ca29ac`, run 1 | Main `8ca29ac`, run 2 | C-12 |
| --- | ---: | ---: | ---: |
| Helix | 80.5 s / 1,146 MiB | 92.0 s / 1,027 MiB | 92.0 s / 1,360 MiB |
| Serde | 41.2 s / 861 MiB | 37.5 s / 894 MiB | 47.5 s / 1,001 MiB |

The index retains invocation names and bounded effects. The resolver also
keeps separate lookup cache entries for the baseline, proved, and assumed
passes. Helix's peak RSS rose 19–32% and C-12 recovered 2,058 Level 2 links,
including 17 with a proof. Serde's cold wall time rose 15–27% and C-12
recovered zero links. Serde completed cold, warm, and query steps in 88.2
seconds.

A cold Serde CPU profile of the pre-C-10 build attributed 14.8 sampled seconds to
`retryMacroScope` across the two Rust graph phases. Macro input and body
profiling accounted for 0.26 sampled seconds. The cost comes primarily from
repeating lookups, even on a pin where those retries recover no targets.

## Coverage plan

The 266,766-byte cumulative archive contains the accepted reference rows,
the C-8 Go rows, the accepted TypeScript rows, and the final Rust candidate
rows. The regeneration test reproduced the entire committed plan
byte for byte. All 19 sweep-tool tests passed. The plan's language totals
include that language's links from mixed-language pins, while the first table
here follows the original 18 Rust pins. [Plan input](../../sweep/plan-input.json.gz) · [Regeneration command](../../sweep/README.md#reproduce-the-committed-plan)

## Supplemental pins

The separate Vector pin `515e87d9` had 402,194 matched Rust sites. Level 2
was 23.26% on updated main, 23.31% with proofs, and 24.39% with assumptions.
The macro-scope diagnostic fell from 133,191 to 132,985 to 129,352. The
4,348 assumed links include 687 checkout targets and 3,661 library targets.
All 93,577 existing definite targets, 92,364 receiver decisions, and symbol
keys matched. Both indexes completed and reported the same five failed
source files. Vector is outside the fixed 60-pin plan.

Before C-10 merged, Embassy completed its cold index on main in 1,003 seconds
and on the C-12 preview in 2,180 seconds. Main completed the warm index in
739 seconds. The candidate reached the one-hour sweep limit during its warm
Rust resolution, so Embassy has no matched row in the 18-pin sweep.

The two Embassy cold graphs initially differed on three previously definite
imports. Replaying main's own captured facts with the replica's project ID
also left all three unresolved. That ID changes the stored traversal order.
Replaying C-12 with main's project ID recovered `crate::raw` in
`platform/aarch32.rs:111` and `platform/riscv.rs:13`, and `super::PpiGroup`
in `embassy-nrf/src/ppi/ppi.rs:3`. The final 18-pin replay pairs each replica
with the same project ID on both builds.

SWC exhausted Node's default heap on main `595ec7b` in the TypeScript
analysis phase, after Rust analysis completed. The candidate attempt was
stopped once the failed baseline ruled out a matched comparison.
