# W2-K: can the Rust build chain provide exact code-graph links?

Investigation only (round 3, after two reviews). Evidence, scripts and raw
outputs: `evidence/w2-k/`. No product code, contract or support level changes.

## The answer

**Partly, and exactly where it answers.** Stable `cargo`/`rustc` (LLVM IR, or
the same data in `asm`, with the dev profile's debug info) give an exact
call → callee record for every call rustc generates code for, including calls
inlined at opt-level 0.

Measured on three Vector crates, with each crate built alone. Figures are shares
of each crate's method calls, in the order `vector-common` / `file-source-common`
/ `tracing-limit`:

| Build set            | With any record       | With a callee definition location |
| -------------------- | --------------------- | --------------------------------- |
| Dev library build    | 40.5% / 11.5% / 16.1% | 36.8% / 10.6% / 10.1%             |
| Dev + test builds    | 74.3% / 93.8% / 100%  | 65.7% / 64.6% / 67.8%             |
| Every stable variant | 80.7% / 93.8% / 100%  | 71.3% / 64.6% / 67.8%             |

The rest of the "any record" share is calls whose callee is only declared, with
no file or line. Building `vector-common`'s workspace dependents too raised it
to at least 87.6% / 78.2%.

What the stable route cannot give falls into three kinds:

- **Limits of debug information itself** (known classes, tested at opt-level 0):
  calls evaluated at compile time, calls rustc rewrites away (`clone()` on a
  `u32`), generic bodies never instantiated in the crates built, cfg branches
  no built feature set selects, and anything in a crate that does not compile.
- **Run-time dispatch:** a `dyn` call is indirect. A devirtualised inlined
  instance names only a subset of its targets.
- **Everything but calls:** no imports, type references or `implements`.

**rust-analyzer**, an optional rustup component, gives an occurrence for 98.7% /
96.5% / 100% of the same calls, and 88.9% (default features) or 98.2% (all
features) of all Vector calls. Where comparable, it agreed with rustc everywhere
(0 disagreements). Calls into std and dependencies come back as symbols without
locations. Correct results require running project code (switched off, they
are wrong, with exit 0), and it degrades silently.

Both toolchain routes run build scripts and proc macros. The IR route does so
as any `cargo build` does.

## The options

Coverage is "method calls with a callee definition location", in the order
`vector-common` / `file-source-common` / `tracing-limit`. For rust-analyzer it
is occurrences, with the in-workspace share that has a location in brackets.

| Option                                                         | Needs installed            | Runs project code       | Coverage                                                                           | Crate that does not compile               | Cost                                                                                                                          |
| -------------------------------------------------------------- | -------------------------- | ----------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| (1) Hand-written W2-C only                                     | Nothing                    | No                      | Structure-level (not measured here)                                                | Partial                                   | Parsing only                                                                                                                  |
| (2) Stable IR tier (dev + test), W2-C underneath               | `cargo`/`rustc` only (D16) | Yes, like `cargo build` | 65.7% / 64.6% / 67.8% (all variants: 71.3% / 64.6% / 67.8%)                        | That crate falls back to W2-C             | Debug builds per changed crate: cold about 1 min, 1.5 GiB, about 2.3 GB target; all variants about 6.4 GB for `vector-common` |
| (3) rust-analyzer when present, W2-C fallback                  | rustup component           | Yes (off = wrong links) | 98.7% / 96.5% / 100% occurrences (22.1% / 17.4% / 8.7% in-workspace with location) | Partial, exit 0, sometimes silently wrong | Whole workspace per change: 4–8 min, 9–13 GiB                                                                                 |
| (4) Layered: W2-C base, then (2), then (3) on top when present | (2); (3) optional          | Yes                     | (2) everywhere, (3) where installed                                                | W2-C (plus partial (3))                   | (2) plus optional (3)                                                                                                         |

## Recommendation: option 4, layered

The numbers argue for it, for these reasons:

1. **It uses only the default build chain, which D16 allows.** Option 2 alone
   gives exact links for about two-thirds of method calls with dev + test
   builds, and a record for 74–100%. Option 3's extra reach comes from a
   component D16 makes optional, so it cannot be the base.
2. **Neither toolchain route is safe on its own for code mid-edit.** IR gives
   nothing for a crate that does not compile, and rust-analyzer can be silently
   wrong. W2-C must stay underneath, and every link must record which route
   produced it.
3. **rust-analyzer adds what IR structurally cannot:** `dyn` and generic calls
   to the trait declaration, uninstantiated and cfg-off code (with the chosen
   feature set), and partial results in broken crates.
4. **Option 3 alone** would leave machines without the component at
   structure-level precision, which option 4 avoids.

Conditions, each a decision or a chunk:

1. **Executing project code.** Karl allows it while indexing Rust; W1-C forbids
   it today. Without that, only option 1 remains.
2. **Several callees at one site.** Sites with more than one callee
   (instantiations: 0–1 sites per crate built alone, 5 for `vector-common` with its dependents; one site had 32 callee
   locations) become one definite `calls` link per impl, marked
   per-instantiation. They are not an "ambiguous" candidate set, because all of
   them are called.
3. **Devirtualised `dyn` targets.** Never reported as "the" target.
4. **Failures.** IR failures are visible (an error, no IR). rust-analyzer
   failures are detected from its log and `diagnostics`, never its exit code.
5. **Mapping and caching.** Links are mapped by definition position. Results are
   cached on snapshot hashes, context files, `rustc -vV`, the tool version and
   the feature set. The build set (dev + test by default) is a stated choice.

Unanswered:

- what building the whole workspace adds, beyond the measured lower bound;
- behaviour under `-O` beyond the `dyn` probe;
- full-Vector byte repeatability;
- LSIF under broken code;
- network needs on other toolchains.

Go is installed on this machine now (go1.27.4) but was not measured in this
chunk; a separate Go investigation will measure it.

Checks: `npm ci`; `npm test` without `PYM_TLC_JAR` gave 1,244 pass, 0 fail, 2
skipped (TLC backend tests: unresolved, not passed); `npm run format:check`
clean.
