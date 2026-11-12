# W2-K: can the Rust build chain provide exact code-graph links?

Investigation only (round 6, after five reviews, with the W2-K2 corrections
after the post-merge review). Evidence, scripts and raw outputs:
`evidence/w2-k/`. No product code, contract or support level changes.

## The answer

**Yes for most method calls in a crate that compiles, through the stable LLVM-IR
route, which gives no other kind of link. Yes for `implements` links and item
declaration locations, through stable rustdoc HTML, which gives no call links
and is not a stable machine interface.** Both are part of the default
toolchain; both run project code.

The IR route: stable `cargo`/`rustc` (LLVM IR, or the same data in `asm`, with the dev
profile's debug info) give an exact call → callee record for every call rustc
generates code for, including calls inlined at opt-level 0. A callee the crate
only declares gets its file:line from the dependencies' own IR, by building
with `RUSTFLAGS="--emit=llvm-ir,link"`.

std callees can additionally be located from the DWARF in the toolchain's
shipped rlibs. That step needs a DWARF reader, which is **not part of the Rust
toolchain** (`llvm-dwarfdump` from the system LLVM package was used here). std
source files exist on disk only when the rustup `rust-src` component is
installed; it is not in rustup's default profile. rustup's optional `llvm-tools` component
does **not** ship such a reader: checked, its `llvm-objdump --dwarf` accepts only
`frames`, and `llvm-readobj` has no DWARF dump
(`raw/route-a/llvm-tools-dwarf-check.txt`; the component was removed again). A
product could instead read the DWARF itself, as these scripts read the IR.

On three crates of one project (Vector), building each crate alone (its dev
library and its test harness), the share of method calls with an exact callee
definition location is:

| Crate                | `cargo`/`rustc` only | Plus a DWARF reader for std |
| -------------------- | -------------------- | --------------------------- |
| `vector-common`      | 73.2%                | 74.3%                       |
| `file-source-common` | 92.3%                | 93.8%                       |
| `tracing-limit`      | 99.3% (98.7%)        | 100%                        |

**Counting rule.** A site counts when at least one of its callee records has a
location. Counting only sites where _every_ callee record has a location
changes two figures, both in `tracing-limit`:

- **Own IR only** (before any lookup): 101/149 (67.8%) becomes 100/149 (67.1%).
  This is `src/lib.rs:569:39` `value.to_string()`: the _same_ callee
  `<str as ToString>::to_string` is defined in the dev build's IR (located at
  `alloc/src/string.rs:2893`) but only declared in the test build's.
- **With dependency IR:** 148/149 (99.3%) becomes 147/149 (98.7%), the figure
  in brackets. This is `src/lib.rs:429:20` `self.start.elapsed()`: the crate has
  `#[cfg(not(test))] use std::time::Instant` and
  `#[cfg(test)] use mock_instant::global::Instant`. So the dev build calls
  std's `elapsed`, located only with the DWARF reader, and the test build calls
  `mock_instant`'s, located from dependency IR.

The rules therefore differ both where the callee differs between builds and
where it is the same but located in only one build. In `vector-common` and
`file-source-common` they give identical figures in every mode
(`raw/route-a/ir-devtest-located.txt` lists every differing site).

Every definition location recovered by the lookup was checked against source,
and every one was valid: 68 per-crate checks (19 + 29 + 20), which are 65
unique file:line:instantiated-name entries and 57 unique file:line locations
across the three crates (`raw/route-a/check-defs-denominators.txt`). The IR
route gives no imports, type references or `implements` links.

**Stable rustdoc HTML** (`cargo doc --no-deps --document-private-items`;
measured in W2-K2 on the hard-case crate, two probe workspaces and
`vector-common`; corrected after review rounds 1 and 2; `raw/rustdoc/`):

- **Gives** item declaration locations (193 of 212 `vector-common` item pages,
  91.0%; the other 19 have no source link in their heading: items inlined from
  other crates and macro redirect pages; all 193 checked against the source)
  and `implements`, with impl locations. Derive, attribute-macro and
  `macro_rules` output is placed at the derive, attribute or invocation line
  (in `vector-common`, 3 of 63 such locations are at the `pub struct` line under
  the attributes). Impls written inside function bodies and `const _` blocks
  were listed when their type is declared outside the body (one probe case
  each). An impl compiled only under `cfg(doc)` is listed although no cargo
  build compiles it (one probe case).
- **A type's page is neither necessary nor sufficient for "this type implements
  the trait".** In the probe crate (rustdoc 1.98.1), an entry appears on a
  type's page without being an impl for that type when the type sits behind
  `&` or `&mut`, inside `Box`, or in the trait's arguments (`impl Tr for &P3`,
  `impl MutRefTr for &mut Q`, `impl Tr for Box<P4>`, `impl From<P11> for u32`).
  An impl whose self type contains the type was absent from its page for the
  other 9 forms measured:
  tuple `(Q, u8)`, array `[Q; 3]`, slice `[Q]`, raw pointer `*const Q`,
  function pointer `fn(Q)`, `dyn AsRef<Q>`, `Option<Q>`, `Vec<Q>` (those are
  under the trait page's impls on foreign types) and a user wrapper `Wrap<Q>`
  (on `Wrap`'s page). An impl through an alias was on the alias's page only. In
  `vector-common`, 10 of the 435 located trait-impl entries are not for the
  page's type. The implementing type has to be read from the impl header, on
  every page scanned, trait pages included, which the corrected reader does.
  For a generic type, an exact entry (`impl Tr for G<u8>`) can cover one
  instantiation only: "exact" is necessary, not sufficient.
- **Completeness across pages.** The reader collects the entries of trait
  pages (implementors and impls on foreign types) as well as type pages; all
  13 forms above were found there. In `vector-common`, the 7 impls on foreign
  types are all for std or dependency types over a type parameter (`Vec<T>`,
  `&[T]`, `FuturesOrdered<Fut>`, …), and the written-block comparison below,
  which matches entries from every section, found all 82 written blocks that
  the documented configuration compiles.
- **Coverage** (`vector-common`): 82 of 104 written `impl Trait for Type`
  blocks listed at their location (78.8%); the other 22 are all cfg'd out of
  the documented configuration. **Accuracy on probed pairs:** compile probes
  found 0 disagreements with rustc on 2,974 of 5,092 (type, trait) pairs in
  `vector-common` and 135 of 225 in the hard-case crate. The round-1 reading
  (any entry on the page) disagrees on 7 of 359 tested pairs in a probe crate
  built for those cases; the corrected reading on 1, the `cfg(doc)`-only impl
  (a configuration difference, not a misread page). The matrix draws types and traits from rustdoc's own
  output, so missing impls are checked only by the written-block comparison.
  Untested pairs have stated causes: 228 a limit of the script's path search,
  1,510 probe-form limits (generic traits or types, lifetime arguments,
  explicit trait arguments), 380 unstable traits.
- **Does not give** call links (0 links other than line anchors in 37 source
  pages; stable rejects `--generate-link-to-definition`). In the probes (one
  case each) it listed no impl for a type declared inside a function body, none
  of a `#[doc(hidden)]` type, and none under `#[cfg(not(doc))]`. In a
  two-crate probe, an impl in the other workspace crate reached a trait's page
  only through a JavaScript file,
  and whether a cross-crate trait in an impl header is a path or plain text
  varied between identical cold runs: trait identity across crates is not
  repeatable this way.
- **Broken code** (24 variants): `cargo doc` exits 0 on 7, with type errors in
  function bodies (including the reviewer's `from_other() -> u32` that
  `cargo check` rejects with E0308), a `static` initializer, an
  associated-const value, a `const _` block or a `const fn` body, still
  listing the impls; so its success does not mean the crate compiles. It fails
  on a type error in a documented `const` item's value, even inside a block
  (for a private `const` only with `--document-private-items`), and on all
  measured item-level (signature, supertrait, overlap, orphan rule,
  where-bound, associated type, array length), syntax and dependency errors.
  In no variant did it list an impl rustc rejects for its header.
- **Runs** build scripts and proc macros. **Cost**, `vector-common`: cold
  38–51 s across five runs, 0.9 GiB, 1.0 GB target; re-run after a touch 1–3 s.
- **Stability:** HTML is rustdoc's output for people; its JSON output is
  nightly. The reader matches the 1.96.1 and 1.98.1 markup only. This bit in
  practice: round 1's reader returned a trait method's location as the
  declaration of 4 `vector-common` items, plausible and without any error.

**Like for like with rust-analyzer** (an optional rustup component). It
analyses one cfg set of its own: default features, plus `cfg(test)`,
`cfg(miri)` and `debug_assertions`. The last two are its default `cargo.cfgs`;
`test` is set for workspace members and also for a non-member path dependency,
while registry dependencies were not probed (`probe/cfg`,
`raw/route-b/cfg-probe.txt`).

**This matches neither the dev build nor the test build:** it skips
`cfg(not(miri))` code that every real build compiles, and analyses
`cfg(miri)` code no real build compiles. Vector has no `miri` cfg, so no figure
here is affected. A rust-analyzer link must be keyed by rust-analyzer's own
configuration, not filed under the IR's test build. Shares of each crate's method calls:

| Share of method calls                                           | `vector-common`                             | `file-source-common` | `tracing-limit` |
| --------------------------------------------------------------- | ------------------------------------------- | -------------------- | --------------- |
| Target in the workspace, with location: stable IR               | 19.5%                                       | 17.7%                | 14.1%           |
| Target in the workspace, with location: rust-analyzer           | 26.8% (LSIF) / 22.1% (SCIP)                 | 17.7% / 17.4%        | 9.4% / 8.7%     |
| Target outside the workspace, with location: stable IR          | 54.8%                                       | 76.1%                | 85.9%           |
| Target outside the workspace, with location: rust-analyzer LSIF | 71.9%                                       | 78.8%                | 90.6%           |
| Target outside the workspace, with location: rust-analyzer SCIP | none (the format has no external locations) | none                 | none            |
| Any target with location: stable IR                             | 74.3%                                       | 93.8%                | 100%            |
| Any target with location: rust-analyzer LSIF                    | 98.7%                                       | 96.5%                | 100%            |

Most method calls in these three crates target std or dependencies (72–91% by
rust-analyzer's own classification). Calls whose target is in the workspace
are where the two routes differ:

- `file-source-common`: IR reaches all 60;
- `tracing-limit`: IR reaches all 14;
- `vector-common`: IR reaches 90 of 125.

These are three crates of one project, not a general rate.

"Workspace" is decided two ways, and the counts coincide (125 / 60 / 14):

- for SCIP and `workspace-gap.mjs`, by rust-analyzer's package classification
  (the symbol's package is a workspace member with definitions in the index);
- for the LSIF rows, by the definition file being under the workspace root.

**Where comparable, the two routes never named different functions for the same
build configuration.** On the dev + test records with the dependency lookup,
these comparisons were made:

- **By definition position:** 64 / 56 / 13 sites, all agreeing.
- **By method name only:** 256 / 258 / 128 outside-workspace sites have the same
  method name. Comparing the defining package on each side within those sites
  found:
  - 0 / 0 / 1 that **differ by build configuration**: `tracing-limit`
    `lib.rs:429:20`. The IR's dev build calls std's `elapsed` (`time.rs:390`),
    its test build calls `mock_instant`'s (`macros.rs:82`), and rust-analyzer,
    under its own configuration (which has `test` on), names only
    `mock_instant`'s. By definition this
    site does **not** agree for the dev build; it matches only by name.
  - 3 / 0 / 0 that differ in **level**: `vector-common`
    `internal_event/cached_event.rs:79, 80, 86`: `self.fixed_tags.clone()` and
    `tags.clone()` in a generic impl. rust-analyzer names the trait declaration `core::clone::Clone::clone`;
    the IR names the instantiated `String` impl in `alloc`.
  - The remaining 253 / 258 / 127 agree by name and defining package.
- **Not compared:**
  - 6 / 3 / 7 further generic-receiver sites (trait declaration vs instantiated
    impl);
  - macro- or derive-generated targets that SCIP gives no location;
  - 1 `vector-common` call with no SCIP occurrence.

For the in-workspace calls the IR reaches (90 / 60 / 14): 64 / 56 / 13 have the
same definition file:line as rust-analyzer's target, the rest are macro output
or a different level, and 0 name a different function.

**The gap is in-workspace targets.** Only 26.8% / 17.7% / 9.4% of calls target
workspace symbols at all.

- `file-source-common` and `tracing-limit`: the stable IR tier reaches all of
  them.
- `vector-common`: it reaches 90 of 125. Of the 35 missed:
  - 12 sit in `byte_size_of.rs`, whose module is behind a non-default feature
    the dev/test builds did not enable;
  - 23 are in generic code never instantiated in this crate's builds: type
    parameters, argument-position `impl Trait` (including the test-enabled
    `emit(event: impl InternalEvent)`), or trait default methods;
  - none were const-evaluated or unexplained.

  cfg conditions were evaluated per measured build (`test` off in dev, on in test); every
  position is listed in `raw/vector/workspace-gap-audit-*.tsv`.

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
`vector-common` / `file-source-common` / `tracing-limit`, except row (2r),
which gives no call links and states its own coverage and accuracy.

| Option                                                                              | Needs installed                                                                                                                                       | Runs project code       | Coverage                                                                                                                                                                                                                                                                                                                                               | Crate that does not compile                                                                                                                                                                    | Cost                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (1) Hand-written W2-C only                                                          | Nothing                                                                                                                                               | No                      | Structure-level (not measured here)                                                                                                                                                                                                                                                                                                                    | Partial                                                                                                                                                                                        | Parsing only                                                                                                                                                                                                |
| (2) Stable IR tier (dev + test, dependency IR lookup), W2-C underneath              | `cargo`/`rustc` only (D16)                                                                                                                            | Yes, like `cargo build` | 73.2% / 92.3% / 99.3% (98.7% with every record located)                                                                                                                                                                                                                                                                                                | That crate falls back to W2-C                                                                                                                                                                  | Cold dev 3–61 s + test 6–24 s per crate, 0.3–1.9 GB of IR, target 0.7–4.1 GB; cargo reuses dependencies afterwards                                                                                          |
| (2+) As (2), plus std located from rlib DWARF                                       | (2) plus a DWARF reader, which is not part of the Rust toolchain (`llvm-dwarfdump` here), and `rust-src` for std files                                | Yes                     | 74.3% / 93.8% / 100%                                                                                                                                                                                                                                                                                                                                   | As (2)                                                                                                                                                                                         | As (2), plus building the std index (2.3 s)                                                                                                                                                                 |
| (2r) Stable rustdoc HTML for `implements` and declaration locations, beside (2)     | `cargo`/`rustdoc` only (D16)                                                                                                                          | Yes, like `cargo build` | No call links. Coverage (`vector-common`): 82 of 104 written trait-impl blocks listed at their location (22 cfg'd out); 193 of 212 item pages with a declaration location. Accuracy on probed pairs: 0 disagreements with rustc (2,974 of 5,092 `vector-common` pairs, 135 of 225 hard-case pairs), reading the implementing type from the impl header | Exit 0, with impl lists, when errors are only in function bodies, `static` initializers, associated-const values, `const _` blocks or `const fn` bodies; nothing otherwise (measured variants) | `vector-common` cold 38–51 s, 0.9 GiB, 1.0 GB target; a reader pinned to rustdoc's HTML. HTML is not a stable interface; a scraping rule has returned plausible wrong locations without error (condition 6) |
| (3) rust-analyzer when present, W2-C fallback                                       | rustup component                                                                                                                                      | Yes (off = wrong links) | LSIF 98.7% / 96.5% / 100% (SCIP: workspace targets only)                                                                                                                                                                                                                                                                                               | Partial, exit 0, sometimes silently wrong                                                                                                                                                      | Whole workspace per change: 4–8 min, 9–13 GiB; index 78 MB (SCIP) or 322 MB (LSIF)                                                                                                                          |
| (4) Layered: W2-C base, then (2) (and (2r) if chosen), then (3) on top when present | (2); (2r) a choice (HTML is not a stable interface; a scraping rule has returned plausible wrong locations without error (condition 6)); (3) optional | Yes                     | (2) everywhere, (3) where installed                                                                                                                                                                                                                                                                                                                    | W2-C (plus partial (3), and (2r) when errors are only in bodies and some values)                                                                                                               | (2) plus (2r) and optional (3)                                                                                                                                                                              |

## Recommendation: option 4, layered

The numbers argue for it, for these reasons:

1. **Its base uses only the default build chain, which D16 allows.** Option 2
   alone (cargo/rustc only) gives an exact, located callee for 73.2% / 92.3% /
   99.3% of method calls in these three crates, and all in-workspace targets in
   two of them. The std DWARF step (2+) adds about 1 point but needs a tool
   outside the Rust toolchain, so it is optional. Option 3's extra reach comes from a component D16 makes optional,
   so it cannot be the base. The default toolchain also gives `implements`
   links through rustdoc HTML (2r): no disagreement with rustc on the 2,974
   `vector-common` pairs tested, once the implementing type is read from the
   impl header rather than from the page. Whether to read it is a choice,
   because its HTML is not a stable interface and a scraping rule has already
   returned plausible wrong locations (condition 6).
2. **No toolchain route is safe on its own for code mid-edit.** IR gives
   nothing for a crate that does not compile; rustdoc HTML gives nothing on
   syntax, item-level and documented-`const` errors, exits 0 as if the crate
   compiled when the errors are in function bodies and some values, and its
   HTML is not a stable interface (a scraping rule has returned plausible
   wrong locations without error, condition 6); and rust-analyzer can be silently wrong. W2-C must stay underneath, and every link must record which route
   produced it.
3. **rust-analyzer adds what IR cannot reach,** though its links too hold only
   for its own cfg set (default features plus `cfg(test)`, `cfg(miri)` and `debug_assertions`, which matches no real build). At
   `tracing-limit` `lib.rs:429:20` it names only `mock_instant`'s `elapsed`:
   the callee under rust-analyzer's own configuration, which there coincides
   with the test build's. That is the configuration-dependent link condition 2
   warns about.
   What it adds:
   - generic bodies never instantiated, and cfg-off code in the chosen feature
     set (the 35 in-workspace misses in `vector-common`: 23 and 12);
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
2. **Several callees at one site.** These come in two kinds, and they must be
   represented differently:
   - **Instantiations of a generic body.** Every instantiated impl is really
     called (in that build), so each becomes a `calls` link, marked
     per-instantiation, not an "ambiguous" candidate set.
   - **Build configurations.** Example: `tracing-limit` `lib.rs:429:20` calls
     std's `elapsed` in the dev build and `mock_instant`'s in the test build. A
     link is true only for the named build configuration it came from (dev vs
     test, feature set), never unconditionally. That applies to **both**
     routes: the IR's per-build records, and rust-analyzer, whose own cfg set
     (default features plus `cfg(test)`, `cfg(miri)` and `debug_assertions`) is a configuration of its own and gives only
     `mock_instant`'s `elapsed` here. Targets that differ between configurations are a set keyed by
     configuration, not several definite links; otherwise production code would
     be shown calling `mock_instant`.
3. **Devirtualised `dyn` targets.** Never reported as "the" target.
4. **Failures.** IR failures are visible (an error, no IR). rust-analyzer
   failures are detected from its log and `diagnostics`, never its exit code.
5. **Mapping, caching and the build set.** Links are mapped by definition
   position. Results are cached on snapshot hashes, context files, `rustc -vV`,
   the tool version, the feature set and rust-analyzer's `cargo.cfgs`. The build set (dev + test, and
   whether std DWARF is read) is a stated choice.
6. **rustdoc HTML, if used.** Pin the rustdoc versions the reader understands and
   treat unrecognised markup as a failure; take "the crate compiles" from
   `cargo check`, not from `cargo doc`; record that its configuration includes
   `cfg(doc)`; identify a trait from another crate by path only where the
   HTML links it, not by its displayed name; take the implementing type from
   the impl header's self type on every page scanned, trait pages included,
   not from the page the entry is on (in the probe, impls for `&T`, `Box<T>`
   or with `T` as a trait argument were on `T`'s page, impls for tuples,
   arrays, slices, pointers, `Option<T>`, `Vec<T>` and other wrappers were
   not); merge pages that are the
   same item; take declarations only from the page heading; and check scraped
   locations against the source.

Unanswered:

- wider build sets with the dependency lookup;
- whole-workspace builds beyond the measured lower bound;
- `-O` beyond the `dyn` probe;
- full-Vector byte repeatability;
- LSIF under broken code;
- rustdoc HTML on other Vector crates, a whole workspace, with dependencies
  documented, and across rustdoc versions; type references in its signatures;
- network needs on other toolchains.

Go is installed on this machine now (go1.27.4) but was not measured in this
chunk; a separate Go investigation will measure it.

Checks (W2-K2, on this branch): `npm ci`; `npm test` without
`PYM_TLC_JAR` gave 1,396 pass, 0 fail, 2 skipped (TLC backend tests:
unresolved, not passed); `npm run format:check` clean.
