# W2-V: patched Rust grammar

The Rust module now loads `grammars/rust/tree-sitter-rust.wasm`: upstream
`tree-sitter-rust` v0.24.2 (`77a37472`, a GitHub release only) plus upstream
PRs #319, #271, #317, #312, #283 and #281 (not #256, not #297). It is built by
`grammars/build.mjs` (the W2-S route, unchanged) from the pinned commit and the
committed patches with tree-sitter CLI 0.27.2, wasi-sdk 34.0 and binaryen
version_132. sha256 `ae20d895…d3ea`; the `--write` build, the verify build
(`evidence/w2-v/build-verify.txt`) and W2-P's scratch build of the same
grammar changes gave the same bytes. Rust module version 23 → 24.

## What changes for users

Valid Rust that used to fail whole files is read. Checked by rustc 1.98.1 and
tested (`test/graph-rust-grammar.test.mjs`, fixtures in
`test/fixtures/rust-grammar/fixed/`):

- **`&raw` on a variable named `raw`** (`&raw`, `&raw[a..]`, `&raw.f`,
  `&&raw`, `&raw.method()`), while `&raw const x` / `&raw mut x` stay raw
  borrows. Vector: 6 files.
- **Edition-2024 FFI: `unsafe extern "C" { … }`**, with `#[link(name = …)]` and
  `#[cfg_attr(…, link(…))]` on the block, variadic declarations
  (`fn printf(fmt: *const c_char, ...)`) and foreign statics. Calls to the
  foreign functions resolve to their declarations.
- **`#[cfg]` on struct-pattern fields**: in `let`, in a match arm, on a
  `field: pattern` entry and in a function-parameter pattern. Vector: 2 files
  (`src/config/builder.rs`, `compiler.rs`).
- A where clause on a unit struct (`struct X where u8: Send;`), `~` in macro
  token trees, `x as size_t <= y` (cast to a named type, then `<=`), `_` in
  unicode escapes (`"\u{4_e}"`), and foreign `type X;` in extern blocks
  (wasm-bindgen input). A foreign type keeps its block's `cfg`, like a
  foreign function.

## Tree shapes and the Rust module

Diffing upstream's node types (unpatched v0.24.2 against patched) gives three
changes. None of them needs a module change:

- `field_pattern` may contain an `attribute_item`. The module reads field
  patterns through their `pattern` / `name` fields, so the attribute is
  ignored. A cfg-gated binding is then treated as always bound. That can only
  block a link (the name counts as local), never make a wrong definite one.
- `associated_type` may carry a `visibility_modifier`. This is how
  `pub type X;` in an extern block parses, and the existing
  `associated_type → type` mapping gives a module-level `type` symbol with
  the block's conditions.
- A new anonymous `~` token inside token trees. The module reads only
  identifiers from token trees.

The grammar location in `parse.ts` changed. The module no longer reads
`tree-sitter-rust`'s `tags.scm` from npm: nothing consumed its captures
(definitions mapped to nothing, and there is no reference mapper). It now
passes a minimal query, as the Go module does, so the vendored grammar does
not depend on query files written for another grammar build. The corpus
comparison below shows identical output wherever the grammar change does not
reach.

## Gaps that remain (each a rustc-checked fixture that still fails the file honestly)

`test/fixtures/rust-grammar/remaining/`, 24 files:

- **Vector's last 3 failed files**:
  - two attributes stacked on one parameter (`lib/codecs/tests/avro.rs`,
    rstest `#[files] #[exclude]`);
  - turbofish on a function named like a primitive, `char::<_, E>(…)`
    (`lib/prometheus-parser/src/line.rs`);
  - `impl A + for<'a> B<'a>` (`lib/tracing-limit/src/lib.rs`).
- **`safe fn` / `safe static` in `unsafe extern` blocks** (edition 2024). Only
  PR #256 parses them, and it makes `safe` reserved, which breaks 29 registry
  files that use `safe` as a parameter, field or macro name (W2-P). W2-P's
  error-site repair (blank `safe`, then re-parse) is the proposed route.
- An attribute on a closure parameter or on a later tuple element;
  `dyn A + for<'a> B<'a>`; turbofish on `u8::<T>()` / `str::<T>()`, inside a
  type, in a struct pattern, or empty (`f::<>()`); a leading `::` generic
  argument (`Result::<::std::vec::Vec<u8>, ()>`); a negative const generic
  argument (`R<-1, 1>`); trailing `+` in bounds; an empty bound (`T:,`); a
  `()` or macro type in a where clause; a primitive-named macro or struct
  (`str![…]`, `u128 { … }`); a closure body `..=e` with an untyped
  parameter; a lone `$` in macro tokens; `try!` in edition 2015.
- The runtime limit: a non-BMP char literal on web-tree-sitter's 5,119-unit
  input chunk boundary. The fix belongs to `src/graph/tree-sitter.ts`.

## Known limits

- **Regression of v0.24.x (upstream's `&raw` fix):** `raw` used as a type name
  (`Option<raw>`, `p::<raw>()`, a syn custom-keyword shape) or bound with
  `raw @ pattern` now fails the file (fixtures in `limits/`, tested). On the
  W2-P crates.io scan: 7 files in 3 crates (syn 1.x, jni-macros,
  zerocopy-derive), all proc-macro crates, out of about 63,700 files. Before,
  those files were read and the `&raw` ones were not.
- `#[cfg]` on a pattern field is ignored by the module (see above); the
  binding counts as always present.

## Fixture location

The grammar fixtures live in `test/fixtures/rust-grammar/`, not
`test/fixtures/graph-rust/grammar/`. `test/graph-rust.test.mjs` copies every
file under `test/fixtures/graph-rust/` into its workspace sample, so the
deliberately unreadable fixtures broke two of its tests there.

## Tests that used the `&raw` gap

PR #13's tests used `&raw` as their "valid for rustc but unreadable" input in
9 places across 6 files. The files are `graph-rust-round8`, `round9` (2),
`round10` (2), `round16` (2) and `round17`, and the
`ancestor-block-path-cases.json` fixture used by `round20`. Each now uses an
empty turbofish, `fn gap()->u8{N}gap::<>()`, with the same return value `N`,
so the comments' rustc answers stay true. That shape stays a gap (a
generated-code shape, the least likely to be closed next). The four tests
that "repair" the file now replace `gap::<>()` with `gap()` instead of
renaming `raw`. All 739 existing Rust graph tests pass.

## Evidence (`evidence/w2-v/`)

Pinned corpus: Vector `515e87d9861b564f521a8992d224892cd8cae120`, a clean
shallow clone made as in `evidence/w2-p/README.md` (never the trial
checkout). The `origin/main` build is compiled in a scratch copy. Both builds
dump the stored graph with `graph-dump.mjs` (files, symbols, links with
resolution).

- **Main against branch, whole project** (`diffs/vector-summary.txt`, full output `diffs/vector.txt.gz`):
  - failed files 11 → 3; the 8 newly read files are listed below;
  - symbols 35,422 → 35,739 and links 365,530 → 370,785. The +317 symbols
    and +5,255 links are exactly the newly read files' own;
  - in the 1,552 previously parsed files: 0 symbols change, and 27,464 links
    in 1,042 files change.
- **Control** (`diffs/vector-control.txt`): main without the 8 files against
  this branch without them gives 0 changed files, symbols or links
  (byte-identical apart from the module version).
- **Complete attribution** (`compare-forced.txt`): this branch's build on
  Vector with the 8 files forced to fail (a syntax error appended to each)
  is identical to main. That covers every file except those 8, every symbol,
  every link and the failed list (11 vs 11; 35,422 symbols; 365,530 links).
  So every one of the 27,464 changed links changes only because those files
  are read.
- **Breakdown by field** (`explain-rust.txt`, `explain-rust.mjs`; a link can
  show several reasons). It classifies 27,463 of the 27,464 links:
  - 11,546 lose `failed-file-unseen-declarations`;
  - 9,948 have a `targetCount` that grows by same-named declarations in the
    newly read files;
  - 3,989 drop an empty target hint along with that reason;
  - 3,845 have only their uncertainty reasons reordered;
  - 1,817 gain or lose opaque-item reasons from items of a newly read file;
  - 475 gain target hints in the newly read files;
  - 184 lose an `invalid-code` cause that named a newly read file;
  - 21 pass the 16-entry hint limit (`too-many-targets`);
  - the one link it does not classify is
    `src/sources/windows_event_log/tests.rs` `use serde_json;`, which loses
    `opaque-item-may-shadow-name`. The forced-failure comparison attributes
    that one too.
- **Links that become definite** (`newly-definite.txt`): 64, all
  unresolved → resolved, none removed, no other resolution change:
  - 15 calls, 5 imports, 7 types and 3 values into the newly read files;
  - 8 `mod` links from parents to those files;
  - 26 macro links (`assert_downcast_matches` 7, `register_validatable_component`
    8, `series` 7, `log_event` 2, `fatal` 2). Each had exactly that one
    target as its only hint and only `failed-file-unseen-declarations` as
    uncertainty. Each macro has exactly one definition in the project, in
    scope through `#[macro_export]` or `#[macro_use]` (checked by hand).
- **Newly read files** (from `diffs/vector-summary.txt`):

  | File                                             | Symbols | Links |
  | ------------------------------------------------ | ------- | ----- |
  | `src/config/builder.rs`                          | 16      | 268   |
  | `src/config/compiler.rs`                         | 13      | 275   |
  | `src/sources/datadog_agent/logs.rs`              | 10      | 254   |
  | `src/sources/datadog_agent/metrics/v3.rs`        | 52      | 1,041 |
  | `vdev/src/commands/check/changelog_fragments.rs` | 22      | 336   |
  | `vdev/src/commands/check/events.rs`              | 96      | 1,297 |
  | `vdev/src/commands/release/generate_cue.rs`      | 66      | 1,219 |
  | `vdev/src/utils/deprecation.rs`                  | 42      | 565   |

  Together: 534 definite links excluding `contains` (843 including them).

- **Sample** (`sample-links.txt`, `sample-links.mjs`, seeded): 32 definite
  links, 4 per newly read file. Each was checked by reading the source and
  its imports (for example `use super::{… Config …}` →
  `src/config/mod.rs:155`, `crate::test_util::mock::basic_sink`, and
  `vector_lib::config::LegacyKey` → `vector_core`). All 32 are correct.
- `fixtures-rustc.txt`: all 30 grammar fixtures pass rustc 1.98.1 in their
  editions.
- `npm-pack.txt`, `clean-build.txt`: the package lists the Rust `.wasm`,
  manifest and licence. A clean `npm ci --ignore-scripts` and build work. The
  packed tarball, installed as a dependency of a scratch project, reads an
  `unsafe extern` file with `#[link]` and a variadic declaration (status
  clean, module version 24, installed `.wasm` sha256 `ae20d895…`).
- **Fetched over the network:** `github.com/tree-sitter/tree-sitter-rust`
  (the pinned commit, by `build.mjs`), the six PR heads once to cut the
  patch files, and Vector `515e87d9` (depth 1).

## Rebuild and update

As in `docs/changes/W2-S.md` ("How to rebuild or update a vendored grammar"),
with `rust` for the language: `node grammars/build.mjs rust` checks and
`--write` replaces. Gate a Rust grammar change on the pinned Vector clone:

1. Dump `origin/main` and the branch with `evidence/w2-v/graph-dump.mjs`.
2. Diff them with `graph-diff.mjs`.
3. For the files whose status changes, run two controls:
   - the project without those files (it must be identical);
   - the branch with those files forced to fail (`compare-forced.mjs`; it
     must be identical to main).
4. Bump the Rust module version.
