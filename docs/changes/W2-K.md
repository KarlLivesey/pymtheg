# W2-K: can the Rust build chain provide exact code-graph links?

Investigation only. Evidence, scripts and raw outputs: `evidence/w2-k/`.
No product code, contract or support level changes.

## The answer

**No, not with `cargo` and `rustc` alone.** On stable, the only output that ties
a call's position to its definition is LLVM IR with the default debug info. It
is exact where it exists: it got every compiled, monomorphic hard case right,
including derive-, attribute- and blanket-supplied methods, `Deref` chains, cfg
branches and calls inside macros. But it covers only code that rustc actually
generates. That leaves out `dyn` calls, generic bodies that are never
instantiated, dead code, inactive cfg branches and unbuilt test code: in
Vector's `vector-common` it covered 23.6% of method calls. It produces no
imports, type references or `implements` links, needs a full debug build of the
crate and its dependencies, and gives **nothing** for a crate with any compile
error. Everything richer (macro expansion, MIR with spans, rustdoc JSON,
save-analysis) needs nightly, and `RUSTC_BOOTSTRAP` is not acceptable for a
product.

**Yes, with rust-analyzer**, which is a rustup component but not part of the
default build chain:

- It resolved every hard case to the method rustc calls.
- On Vector it gave an occurrence for 97.7% of 72,301 method calls.
- It agreed with rustc on all 17 calls where both name a workspace definition,
  with 0 disagreements among 110 cross-checked positions.

The costs are real:

- It always runs build scripts and proc macros; SCIP mode ignored the settings
  meant to turn them off.
- With them off, derive and attribute calls resolve to the **wrong** method,
  not to "unknown".
- When dependencies are unfetched, or a proc-macro crate fails to build, it
  still exits 0, with wrong or missing links. Only its log and `diagnostics`
  reveal this.
- It needed network once per toolchain, for the standard library's own
  metadata.
- Whole Vector took about 4–5 minutes and 9–12 GiB for every re-run.
- Its symbol strings are not unique, so links must be mapped by definition
  position.

## Recommendation: option 3, rust-analyzer when present, hand-written fallback otherwise

| Option | Precision | What it costs the user |
|---|---|---|
| (1) stable cargo/rustc only | Exact but partial: only compiled monomorphic calls; no `dyn`/generic/dead/cfg-off/test code; whole crate lost on any error | Nothing to install; a full debug build per change (`vector-common`: 45 s, 1.9 GB target); runs build scripts and proc macros |
| (2) rust-analyzer required | Near-complete call links, trait-impl relationships | `rustup component add rust-analyzer` (one command, about 45 MB); network once per toolchain; dependencies fetched; minutes and up to about 12 GiB per change on a Vector-sized workspace; executes project code; Rust indexing refuses to run without it |
| (3) rust-analyzer when present, W2-C fallback | (2) where present, otherwise structure-level | As (2) on machines that have it; nothing extra otherwise; results differ by machine, so every link records which route produced it |

Option (1) does not answer the owner's need: it is exact only on the easy part.
Option (2) contradicts D16's "optional extras unless Karl says otherwise".
Option (3) keeps D16 and gets precision where the developer already has the
component.

Conditions for (3), each needing a decision or a chunk:

1. Karl allows executing project code while indexing Rust. W1-C currently
   forbids it, and there is no execution-free rust-analyzer mode that is also
   correct.
2. The module treats a run as degraded, and falls back per crate, when the log
   shows `cargo metadata failed` or `diagnostics` shows `unresolved-macro-call`
   or `proc-macro not yet built`. The exit status cannot be trusted.
3. It maps links by definition position (UTF-8 to UTF-16 using the snapshot
   text), checks that the files on disk match the snapshot hashes, and caches on
   a key of snapshot hashes, context files, `rustc -vV`, the rust-analyzer
   version and the feature configuration, so an unchanged re-index does no work.
4. Macro-generated targets with no source location stay unresolved, with the
   name kept.
5. rust-analyzer's CLI explicitly makes no stability promise, so pin and test
   the versions supported.

Unanswered:

- whether Vector-scale output repeats exactly across runs (it did on the tiny
  crate);
- what makes up the 2.3% of Vector calls with no occurrence;
- whether DWARF adds anything to the IR route (not measured).

Go (not installed) is expected to need only `go` plus a standard-library
`go/types` helper; the measurements to run once it is installed are listed in
the evidence README.
