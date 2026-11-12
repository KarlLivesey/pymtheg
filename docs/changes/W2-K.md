# W2-K: can the Rust build chain provide exact code-graph links?

Investigation only (round 2, after review). Evidence, scripts and raw outputs:
`evidence/w2-k/`. No product code, contract or support level changes.

## The answer

**Not completely, with `cargo` and `rustc` alone; what they cannot do is a known
set of call classes.** On stable, LLVM IR with the default debug info is the
only output that ties a call's position to its callee and the callee's
definition. Where it exists it is exact: it got every compiled hard case right.

Combining stable builds raises its coverage of `vector-common`'s 467 method
calls:

| Stable builds                               | Coverage                         |
| ------------------------------------------- | -------------------------------- |
| dev library build                           | 39.2%                            |
| dev + test builds                           | 71.1%                            |
| dev + test, with `-C link-dead-code`        | 72.2%                            |
| every variant tried, including all features | **77.5%** (the measured ceiling) |

Four classes remain impossible whatever the flags:

- `dyn` calls (no static callee);
- generic bodies never instantiated in any build;
- cfg branches no built feature set selects;
- every call in a crate that does not compile.

The IR also has no imports, type references or `implements`. Stable MIR names
callees even where the IR does not, but carries no call-site positions and
declares itself "for human consumers only". Macro expansion, MIR with spans and
rustdoc JSON need nightly; save-analysis has been removed.

(Round 1's "23.6%" was a bug in my IR parser, which missed `invoke` calls.)

**With rust-analyzer** (a rustup component, not in the default build chain), the
hard cases all resolved to the method rustc calls. Vector coverage:

| Feature set  | Occurrence, of all 79,454 calls in the 1,563 tracked `.rs` files | Within the files it indexed |
| ------------ | ---------------------------------------------------------------- | --------------------------- |
| Default      | 88.9%                                                            | 97.7% (1,481 files)         |
| All features | 98.2%                                                            | 99.8%                       |

In the default run, 82 files (9.0% of calls) are behind inactive features and
were never analysed.

The cross-check against rustc on `vector-common` found **0 disagreements**:

- 71 calls compared by definition position, all agreeing;
- 217 compared by method name only, all agreeing;
- 74 not comparable (macro-generated, external declarations, generic receivers).

The costs:

- **Project code runs.** By default it runs build scripts and proc macros.
  `cargo.buildScripts.overrideCommand` switches that off, and then derive and
  attribute calls resolve to the **wrong** method, with exit 0. No mode is both
  execution-free and correct.
- **Failures are silent.** Missing dependencies, a failing proc-macro crate, or
  no network for the standard library's metadata give wrong or missing links,
  still with exit 0. Offline: 7.4% or 30.0% coverage of all calls. Network was
  needed once for the one toolchain observed.
- **Runtime.** A whole-workspace run took about 4–8 minutes and up to about
  12 GiB on Vector, one run per feature set.
- **Identity.** Symbol strings are not unique, so links must be mapped by
  definition position.

## Recommendation: option 3, rust-analyzer when present, hand-written fallback otherwise

| Option                                        | Precision                                                                                                                                                                                                                                                                | What it costs the user                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (1) stable cargo/rustc only                   | Exact for generated code. Up to 77.5% of method calls in a crate that compiles, with every variant built; 39.2% from a dev build. Never `dyn`, uninstantiated generics or unselected cfg. Nothing for a crate with an error; no imports, type references or `implements` | Nothing to install. Several full debug builds per change (`vector-common`: about 1 minute and about 2 GB each, cold). Runs build scripts and proc macros                                                                                            |
| (2) rust-analyzer required                    | All call classes, for the analysed cfg set: 88.9% of Vector's calls with default features, 98.2% with all features. Trait-impl relationships                                                                                                                             | `rustup component add rust-analyzer` (one command, about 45 MB). Network at least once. Dependencies fetched. Minutes and up to about 12 GiB per change on a Vector-sized workspace. Executes project code. Rust indexing refuses to run without it |
| (3) rust-analyzer when present, W2-C fallback | (2) where present, otherwise structure-level                                                                                                                                                                                                                             | As (2) on machines that have it; nothing extra otherwise. Results differ by machine, so every link records the route that produced it                                                                                                               |

Option (1) cannot give `dyn` or uninstantiated-generic calls, and loses every
link in a crate mid-edit. Agents index broken trees, so it cannot be the
precision route; it might serve as an extra cross-check. Option (2) contradicts
D16's "optional extras unless Karl says otherwise". Option (3) keeps D16 and
gets near-complete links where the developer has the component.

Conditions for (3), each a decision or a chunk:

1. Karl allows executing project code while indexing Rust. W1-C forbids it, and
   the execution-free mode is wrong.
2. Degraded runs are detected from the log (`cargo metadata failed`) and
   `diagnostics` (`unresolved-macro-call`, `proc-macro not yet built`), and
   handled with a per-crate fallback. The exit code cannot be trusted.
3. Links are mapped by definition position, with disk checked against the
   snapshot hashes. The cache key covers the snapshot hashes, context files,
   `rustc -vV`, the rust-analyzer version and the feature set, so an unchanged
   re-index does no work.
4. The analysed feature set is a stated choice: default, all, or configured.
5. Macro-generated targets with no location stay unresolved with the name kept.
6. The supported rust-analyzer versions are pinned and tested; its CLI has no
   stability promise.

Unanswered:

- whether full Vector output repeats byte-for-byte (tiny crate did);
- what the 1,691 default-run calls with no occurrence in indexed files are;
- whether DWARF adds anything to IR;
- LSIF under broken code;
- network needs on toolchains other than the one observed.

Go is installed on this machine now (go1.27.4) but was not measured in this
chunk; a separate Go investigation will measure it.

Checks: `npm ci`; `npm test` without `PYM_TLC_JAR` gave 1,244 pass, 0 fail, 2
skipped. The 2 skips are TLC backend tests, unresolved rather than passed.
`npm run format:check` is clean.
