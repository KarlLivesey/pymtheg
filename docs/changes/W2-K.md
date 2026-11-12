# W2-K: can the Rust build chain provide exact code-graph links?

Investigation only (round 4, after three reviews). Evidence, scripts and raw
outputs: `evidence/w2-k/`. No product code, contract or support level changes.

## The answer

**Yes for most method calls in a crate that compiles; no for any other kind of
link.**

Stable `cargo`/`rustc` (LLVM IR, or the same data in `asm`, with the dev
profile's debug info) give an exact call → callee record for every call rustc
generates code for, including calls inlined at opt-level 0. A callee the crate
only declares gets its file:line from the dependencies' own IR, by building
with `RUSTFLAGS="--emit=llvm-ir,link"`. std ones come from the DWARF in the
toolchain's shipped rlibs.

On three Vector crates, building each crate alone (dev library + test harness),
the share of method calls with an exact callee definition location is:

| Crate                | Stable cargo/rustc only | Plus std rlib DWARF |
| -------------------- | ----------------------- | ------------------- |
| `vector-common`      | 73.2%                   | 74.3%               |
| `file-source-common` | 92.3%                   | 93.8%               |
| `tracing-limit`      | 99.3%                   | 100%                |

All 68 distinct recovered locations were checked against source and are
correct. The stable route gives no imports, type references or `implements`
links.

**Like for like with rust-analyzer** (default features; it is an optional
rustup component). Shares of each crate's method calls:

| Share of method calls                                           | `vector-common`                             | `file-source-common` | `tracing-limit` |
| --------------------------------------------------------------- | ------------------------------------------- | -------------------- | --------------- |
| Target in the workspace, with location: stable IR               | 19.5%                                       | 17.7%                | 14.1%           |
| Target in the workspace, with location: rust-analyzer           | 26.8% (LSIF) / 22.1% (SCIP)                 | 17.7% / 17.4%        | 9.4% / 8.7%     |
| Target outside the workspace, with location: stable IR          | 54.8%                                       | 76.1%                | 85.9%           |
| Target outside the workspace, with location: rust-analyzer LSIF | 71.9%                                       | 78.8%                | 90.6%           |
| Target outside the workspace, with location: rust-analyzer SCIP | none (the format has no external locations) | none                 | none            |
| Any target with location: stable IR                             | 74.3%                                       | 93.8%                | 100%            |
| Any target with location: rust-analyzer LSIF                    | 98.7%                                       | 96.5%                | 100%            |

Most method calls in these crates target std or dependencies (72–91% by
rust-analyzer's own classification). For in-project targets the two routes give
about the same coverage. Where both answer, they never disagreed.

**The real gap is in-workspace targets.** Only 26.8% / 17.7% / 9.4% of calls
target workspace symbols at all. Workspace here is decided by rust-analyzer: the
symbol's package is a workspace member, meaning it has definitions in the index.

- `file-source-common` and `tracing-limit`: the stable IR tier reaches all of
  them.
- `vector-common`: it reaches 90 of 125. Of the 35 missed, 14 sit in
  `byte_size_of.rs`, whose module is behind a non-default feature that the
  dev/test builds did not enable. The other 21 are in generic bodies or trait
  default methods never instantiated in this crate's builds. None were
  const-evaluated or unexplained.

Wider stable build sets (all features, dependents) were measured in round 3
without the dependency lookup: up to 80.7%, and at least 87.6% with dependents.
They have not been re-measured with the lookup.

**Limits of stable debug information itself:**

- calls evaluated at compile time;
- calls rustc rewrites away (`clone()` on a `u32`);
- generic bodies never instantiated;
- unselected cfg branches;
- anything in a crate that does not compile.

`dyn` calls are indirect; a devirtualised inlined instance names only a subset
of the targets.

rust-analyzer needs project code to run: switched off, its derive and attribute
links are wrong, with exit 0. It also degrades silently. The stable IR route
also runs build scripts and proc macros, as any `cargo build` does.

## The options

Coverage is "method calls with a callee definition location", in the order
`vector-common` / `file-source-common` / `tracing-limit`.

| Option                                                                 | Needs installed            | Runs project code       | Coverage                                                                                           | Crate that does not compile               | Cost                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| (1) Hand-written W2-C only                                             | Nothing                    | No                      | Structure-level (not measured here)                                                                | Partial                                   | Parsing only                                                                                                       |
| (2) Stable IR tier (dev + test, dependency IR lookup), W2-C underneath | `cargo`/`rustc` only (D16) | Yes, like `cargo build` | 73.2% / 92.3% / 99.3%; with std DWARF (a DWARF reader, `llvm-dwarfdump` here) 74.3% / 93.8% / 100% | That crate falls back to W2-C             | Cold dev 3–61 s + test 6–24 s per crate, 0.3–1.9 GB of IR, target 0.7–4.1 GB; cargo reuses dependencies afterwards |
| (3) rust-analyzer when present, W2-C fallback                          | rustup component           | Yes (off = wrong links) | LSIF 98.7% / 96.5% / 100% (SCIP: workspace targets only)                                           | Partial, exit 0, sometimes silently wrong | Whole workspace per change: 4–8 min, 9–13 GiB; index 78 MB (SCIP) or 322 MB (LSIF)                                 |
| (4) Layered: W2-C base, then (2), then (3) on top when present         | (2); (3) optional          | Yes                     | (2) everywhere, (3) where installed                                                                | W2-C (plus partial (3))                   | (2) plus optional (3)                                                                                              |

## Recommendation: option 4, layered

The numbers argue for it, for these reasons:

1. **It uses only the default build chain, which D16 allows.** Option 2 alone
   gives an exact, located callee for 73–99% of method calls in these crates
   (74–100% with the std DWARF step), and all in-workspace targets in two of
   the three. Option 3's extra reach comes from a component D16 makes optional,
   so it cannot be the base.
2. **Neither toolchain route is safe on its own for code mid-edit.** IR gives
   nothing for a crate that does not compile, and rust-analyzer can be silently
   wrong. W2-C must stay underneath, and every link must record which route
   produced it.
3. **rust-analyzer adds exactly what IR cannot reach:**
   - generic bodies never instantiated, and cfg-off code in the chosen feature
     set (the 35 in-workspace misses in `vector-common`);
   - `dyn` and generic calls to the trait declaration;
   - const-evaluated and rewritten calls (`Kc(3).c()`, `n.clone()`), which
     rust-analyzer resolves and IR cannot;
   - partial results in broken crates.

   That makes it the right optional top layer. Use LSIF rather than SCIP if
   external locations matter.

4. **Option 3 alone** would leave machines without the component at
   structure-level precision, which option 4 avoids.

Conditions, each a decision or a chunk:

1. **Executing project code.** Karl allows it while indexing Rust; W1-C forbids
   it today. Without that, only option 1 remains.
2. **Several callees at one site.** A site with several callees (per
   instantiation) becomes one definite `calls` link per impl, marked
   per-instantiation, not an "ambiguous" candidate set.
3. **Devirtualised `dyn` targets.** Never reported as "the" target.
4. **Failures.** IR failures are visible (an error, no IR). rust-analyzer
   failures are detected from its log and `diagnostics`, never its exit code.
5. **Mapping, caching and the build set.** Links are mapped by definition
   position. Results are cached on snapshot hashes, context files, `rustc -vV`,
   the tool version and the feature set. The build set (dev + test, and
   whether std DWARF is read) is a stated choice.

Unanswered:

- wider build sets with the dependency lookup;
- whole-workspace builds beyond the measured lower bound;
- `-O` beyond the `dyn` probe;
- full-Vector byte repeatability;
- LSIF under broken code;
- network needs on other toolchains.

Go is installed on this machine now (go1.27.4) but was not measured in this
chunk; a separate Go investigation will measure it.

Checks: `npm ci`; `npm test` without `PYM_TLC_JAR` gave 1,244 pass, 0 fail, 2
skipped (TLC backend tests: unresolved, not passed); `npm run format:check`
clean.
