# C-1 validation after merging PR 9

The merged build uses `analyzeModule` and `runResolve` from main at
`32ca757`. The analysis and resolution calls forward the coordinator's
signal. Both error handlers propagate the caller's abort reason. The Rust
analysis worker receives paths and parse results plus Cargo inputs.
The resolve worker receives Rust file summaries, symbols and links plus
Cargo inputs.

The dev-server build, TypeScript check (`tsc --noEmit`), and
`npm run format:check` passed. All 2,943 tests passed in `npm test`.

## Stored link identity

Each pin produced identical exported breakdown rows and normalized SQLite
link dumps on main and the merged build. The same hashes were recorded on
`pymtheg@0.1.0`.
[Comparison method](README.md#reproduction) · [Release hashes](link-identity.json)

| Repository | Identical links | SHA-256 of each normalized dump |
| --- | ---: | --- |
| BurntSushi/ripgrep | 39,086 | `6c387a0583131515ef9adf400e5de5f36bb92e08557abcdd8faf4e0961454cac` |
| helix-editor/helix | 86,281 | `bcdcc588d624b54703ba68cb64d43d64547387b51026dd009b033f3736aa9269` |
| tokio-rs/axum | 39,950 | `7f6c55681afac7dcc6b1f44054eac82fbf53b84b132b61c0bade96cfcce46101` |

## Cancellation

The production CLI cancellation tests passed with the indefinitely busy
Rust worker fixture. SIGINT during analysis and SIGTERM during resolution
each produced exit 130 and allowed a successful retry. In a scratch copy
of the build, removing the signal at both phase call sites made both tests
fail with exit 0 instead of 130.

## Rerun of previously stalled repositories

| Repository | Cold outcome | Cold wall time | Peak RSS | Level 2 |
| --- | --- | ---: | ---: | ---: |
| Dioxus | Finished, three failed source files | 1,243.404 s | 2,135.9 MiB | 36.8420% |
| Embassy | Wall limit after Rust analysis | 3,606.403 s | 3,543.6 MiB | — |
| Rustls | Finished, one failed source file | 420.781 s | 1,324.1 MiB | 26.9079% |
| Serde | Finished, clean | 230.048 s | 882.7 MiB | 36.4664% |

Serde stored 29,641 links. Its 10,809 Level 2 links reproduce the first
C-1 sweep. The coverage generator uses the earlier SWC wall-limit record.
[SWC profile](swc-profile.json)

## Helix inline and worker memory

Two sequential cold indexes used separate copies of the same pin without
any graph store. Both called production `executeGraph`. The second supplied
an `AbortSignal`, which selects the Rust workers. GNU `time` measured the
whole process, including the worker threads.

| Rust phase placement | Stored links | Peak RSS | Wall time |
| --- | ---: | ---: | ---: |
| Inline | 86,281 | 1,200,012 KiB (1,171.9 MiB) | 442.70 s |
| Worker | 86,281 | 1,202,728 KiB (1,174.5 MiB) | 434.45 s |

The observed worker peak was 2,716 KiB higher (0.23%). These are single
runs on the shared dev server.

## Embassy wall limit

The earlier cold sweep finished Embassy in 2,354.6 seconds. In the merged
sweep, the last progress line was `graph analyze rust: 2514/2514`. The CLI
emits that line after the worker returns. The indexer then validates the
returned facts and writes the changed files to SQLite. The process was
waiting in the filesystem at the limit, before the Rust resolve marker.
[Analysis progress](../../src/graph/commands.ts) · [Database writes](../../src/graph/indexer.ts)

## Coverage plan

The generator used main's 55 completed pins as its baseline. The two
fresh main sweeps for the repositories added by PR 9 hit the wall limit.
Retries on their existing stores recovered 483,985 TypeScript repository
links and 726,108 Turborepo links, matching the published C-2 totals. The
coverage exporter checked each SQLite breakdown against its retry's CLI
totals. The baseline uses those completed graphs and C-2's recorded sweep
outcomes.
[C-2 evidence](../c-2/summary.md)

The merged sweep brings the count to 58 of 60. Weighted Rust Level 2 moves
from 31.4718% to 31.8986% as Dioxus, Rustls and Serde enter the score.
Embassy and SWC remain open in the generated plan.
[Coverage plan](../../docs/coverage-plan.md)
