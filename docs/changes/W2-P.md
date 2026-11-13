# W2-P: grammar gaps investigation

Investigation only. No change to `src/`, `package.json`, `package-lock.json`
or tests; no support level or contract changes. Evidence, scripts and raw
outputs are in `evidence/w2-p/` (index: `evidence/w2-p/README.md`).

## The answer

- **The grammars reject much more valid code than the known list.** Of 116
  Rust and 46 Go snippets (162), 153 pass the stable compilers (rustc 1.98,
  Go 1.27). Nine do not: six need nightly Rust, and three are rejected
  outright (`dyn-star`, `impl-const`, `generic-interface-method`). The installed grammars reject **39 valid Rust and 13 valid
  Go** snippets (`gaps-output.txt`). On real code: Vector 11 files and restic 1
  (both fully explained, below); the local crates.io cache 1,904 of ~63,700
  `.rs` files (1,468 of them are `wasm-bindgen` input in 6 crates); the Go
  module cache 3 valid files plus Go toolchain test data.
- **No newer npm release exists** (`tree-sitter-rust` latest 0.24.0,
  `tree-sitter-go` latest 0.25.0). Upstream's Rust **v0.24.1 / v0.24.2 exist
  only as GitHub releases** with a prebuilt `.wasm` (ABI 15, loads in our
  runtime). v0.24.2 fixes `&raw` on a variable and `unsafe extern` blocks
  (6 of Vector's 11 files; 175 registry files), changes no tree of any file
  that was clean, and breaks 7 registry files that use `raw` as a type name or
  in `raw @ pat` (proc-macro crates: syn 1.x, jni-macros, zerocopy-derive).
- **Most other gaps have open, unmerged upstream PRs.** Their `grammar.js`
  changes apply cleanly. Building them ourselves with tree-sitter CLI 0.27.2
  takes seconds and needs no end-user install hook. Six Rust PRs fix 9 more
  snippets and add no regressions (two others are harmful: #256 makes `safe`
  reserved, #297 breaks `macro_rules` used as an identifier). Two Go PRs
  (#202, #198) fix 8 of 13 Go snippets, with **0 broken files and 0 changed trees over 21,525 Go files**.
  (#190 instead changes the tree of 1,785 clean files and is rejected.)
- **Found on the way: a runtime bug, not a grammar gap.** `web-tree-sitter`
  splits a UTF-16 surrogate pair at its 5,119-unit input chunk. A non-BMP
  character in a Rust char literal or a Rust/Go identifier that starts exactly
  there makes the file fail (regex-syntax's Unicode tables: 2 files). A
  surrogate-safe parse callback removes it with identical trees
  (`chunk-boundary-output.txt`). It is not fixed upstream either.
- **Pre-passes are sound only for a few tokens.** The sound ones are a
  qualifier (`unsafe` before an extern block, `safe` before a foreign item), a
  Go empty statement `;`, a missing final newline, and `~` / lone `$` inside
  macro token trees. They are safe only as error-site repairs that run on a
  file that already fails and are checked by re-parsing. Everything else
  (attributes, `&raw`, turbofish, bounds) changes meaning or names, or needs
  parse context a token rewrite does not have. The fix for those is the grammar.

## Recommendation table

Counts: snippets are in `gaps-output.txt`. Corpus columns: Vector / restic files;
"registry" = files (distinct crates) in the crates.io cache;
"Go cache" = valid files in the Go module cache. Commonness is my judgement
for complex Rust/Go database and filesystem projects.

| Gap                                                                                                                                                                         | Corpus                                                                                                     | Common in systems code?                                               | Fix                                                                                                | Effort                               | Risk                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Rust `&raw` on a variable named `raw` (`&raw`, `&raw[..]`, `&raw.f`, `&&raw`)                                                                                               | Vector 6; registry 73 (34)                                                                                 | **High**: `raw` is an everyday name for byte buffers                  | Grammar v0.24.2 (GitHub release)                                                                   | small                                | Breaks `raw` as a type name / `raw @` (7 registry files, proc-macro crates); no tree changes elsewhere                                     |
| Rust `unsafe extern "C" { … }` (required in edition 2024)                                                                                                                   | registry 103 (22): fuser, backtrace, getrandom, linux-raw-sys, sysinfo, mlua-sys                           | **High** for FFI / edition 2024                                       | Grammar v0.24.2                                                                                    | (same chunk)                         | as above                                                                                                                                   |
| Rust `#[cfg]` on struct-pattern fields (let, match arm, `f: pat`, fn-parameter pattern)                                                                                     | Vector 2; registry 23 (14): quinn, hickory, redis, mongodb, async-task, portable-atomic, proc-macro2, jiff | **High** in feature-gated code                                        | Patched grammar: PR #319                                                                           | medium (first patched build)         | No regressions found; it is an unmerged PR, so every build must pass the `compare.mjs` gate                                                |
| Go `new(expr)` (Go 1.26) and user-declared `new`/`make` called with values                                                                                                  | restic 1; Go cache 2                                                                                       | **High** in new Go (`new(true)`, pointer-to-value helpers)            | Patched grammar: PR #202                                                                           | small (after the build route exists) | 0 broken, 0 tree changes on 21,525 files                                                                                                   |
| Go generic methods (Go 1.27)                                                                                                                                                | none yet (too new)                                                                                         | **Rising**: new Go code will use them                                 | Patched grammar: PR #198                                                                           | (same chunk as #202)                 | as above                                                                                                                                   |
| Rust two or more attributes on one parameter; attribute on a closure parameter                                                                                              | Vector 1; registry 39 (4), mostly rstest                                                                   | Medium (rstest test suites)                                           | Own grammar patch (no upstream PR tested)                                                          | medium                               | Unknown until written                                                                                                                      |
| Rust turbofish on a primitive-named fn (`char::<_, E>`, `u8::<T>`, `f32::<…>`)                                                                                              | Vector 1; registry 1 + nom tests                                                                           | Medium (nom parsers for wire formats)                                 | Own grammar patch                                                                                  | medium                               | Unknown                                                                                                                                    |
| Rust `impl A + for<'a> B<'a>` / `dyn A + for<'a> B<'a>`                                                                                                                     | Vector 1                                                                                                   | Low–medium (tracing-subscriber idiom)                                 | Own grammar patch                                                                                  | small–medium                         | Unknown                                                                                                                                    |
| Rust `~` / lone `$` / `$ name` in macro token trees                                                                                                                         | registry 18 (9) + 24 (7): anyhow, syn, bigdecimal, icu, cfg_aliases                                        | Low in project code, medium in macro-heavy crates                     | `~`: PR #317. `$`: error-site repair (blank the token; PR #13's module does not read macro bodies) | small                                | Repair is sound only while no module expands or matches macro bodies                                                                       |
| Rust `safe fn` / `safe static` in extern blocks                                                                                                                             | registry 1 (getrandom)                                                                                     | Low now, rising with edition 2024                                     | Error-site repair (blank `safe`), not PR #256                                                      | small                                | Sound: in valid code `safe` only marks call safety. Masks `safe fn` placed wrongly (rustc rejects it), which then indexes like a normal fn |
| Go empty statement `;` (e.g. `func(){; G()}`)                                                                                                                               | none in corpora                                                                                            | Low (generated code)                                                  | Error-site repair: blank a lone `;` ERROR inside a block                                           | small                                | Sound (an empty statement does nothing)                                                                                                    |
| Go file with no final newline after `}` / `)`                                                                                                                               | Go cache 1 valid (msgp generated) + 5 test-data                                                            | Low–medium (generators that skip gofmt)                               | Repair: append `\n` (moves no offset)                                                              | small                                | Sound                                                                                                                                      |
| Non-BMP char/identifier on the 5,119-unit chunk boundary (runtime)                                                                                                          | registry 2 (regex-syntax)                                                                                  | Rare, effectively random                                              | Surrogate-safe parse callback in `src/graph/tree-sitter.ts`                                        | small                                | Sound; identical trees in the sweep                                                                                                        |
| Rust unit struct with `where` (static-assert idiom)                                                                                                                         | registry 12 (2): syn, darling                                                                              | Low                                                                   | PR #271                                                                                            | (with #319)                          | none found                                                                                                                                 |
| Rust `x as size_t <= y` (cast to a named type, then `<=`; c2rust-style code)                                                                                                | registry 2 (1): unsafe-libyaml                                                                             | Low; higher in C-translated FFI code                                  | PR #312                                                                                            | (with #319)                          | none found                                                                                                                                 |
| Rust `type X;` in extern blocks                                                                                                                                             | registry 1,468 (6): web-sys, js-sys, wasm-bindgen                                                          | None for db/fs (wasm-bindgen)                                         | PR #281                                                                                            | (with #319)                          | none found                                                                                                                                 |
| Rust `\u{4_e}`                                                                                                                                                              | registry 3 (2)                                                                                             | Rare                                                                  | PR #283                                                                                            | (with #319)                          | none found                                                                                                                                 |
| Rust generic-argument shapes: leading `::` (`Result::<::std::vec::Vec<T>>`), turbofish inside a type, turbofish struct pattern, empty `::<>`, negative const arg `R<-1, 1>` | registry 33 (1, aws-sdk codegen) + 5 (4) + 1 + 1 (lalrpop output) + 5 (2: time, deranged)                  | Low–medium: **generated code** (Smithy SDKs, lalrpop parsers), `time` | Own grammar patches                                                                                | medium                               | Unknown                                                                                                                                    |
| Rust where-clause shapes: `(): Tr<…>`, `T:,` (empty), `mac!(Self): Send`, trailing `+`                                                                                      | registry 17 (2) + 2 + 3 (2) + 1                                                                            | Low (typenum / zerocopy generated code)                               | Own grammar patches                                                                                | small each                           | Unknown                                                                                                                                    |
| Rust tuple element after the first with an attribute                                                                                                                        | registry 2 (1): zerovec; sqlx `match (…, #[allow] x)`                                                      | Low                                                                   | Own grammar patch                                                                                  | small                                | Unknown                                                                                                                                    |
| Rust primitive-named macro / struct (`str![…]`, `u128 { … }`); closure body `..=x`                                                                                          | registry 17 (2: snapbox tests) + 1 + 1                                                                     | Low                                                                   | Own grammar patches                                                                                | small                                | Unknown                                                                                                                                    |
| Rust `try!` in edition-2015 crates                                                                                                                                          | registry 14 (6): autocfg, slog, vcpkg                                                                      | **None for project code** (2015 edition only)                         | Accept (report as unreadable by Pymtheg)                                                           | —                                    | —                                                                                                                                          |

Nightly-only syntax (`auto trait`, `box` patterns, trait aliases, `dyn*`,
`impl const`) is rejected by rustc stable and is not a gap.

### What a tolerated-error rule would and would not trust

The repairs above put the tolerated-error idea (option (c) of the brief) in a
safer form. The construct is never trusted from the broken tree. The file is
re-parsed with that one token blanked, and only a fully clean tree counts.
After the repair:

- **Trusted:** every symbol and link the module extracts, at the original
  offsets. The repaired file is an ordinary clean parse.
- **Not trusted, and lost on purpose:** the blanked token's own meaning: the
  `unsafe` marker of an extern block, the `safe` qualifier, the `~`/`$` token
  inside a macro's input, the empty statement. No module reads any of these
  today. The macro-token repair must be withdrawn if a module ever matches or
  expands macro bodies.
- **Never repaired:** attributes (a blanked `#[cfg]` would make a cfg-gated
  binding unconditional), `&raw` (dropping `&` changes the expression), names,
  paths, generics. For these a lexical rewrite cannot know the context, so the
  grammar must parse them.

Measured on the corpora with the installed grammars (`prepass-corpus-installed.txt`):
85 registry files and 6 Go-cache files become clean. Vector and restic: 0,
because their gaps are all grammar-level.

## Proposed follow-up chunks (each one small pull request)

1. **Runtime chunk fix.** Surrogate-safe input callback in
   `src/graph/tree-sitter.ts`, plus a test at the 5,118 offset. Core only;
   small. Note that PR #13's own error walk, like Go's, misses zero-width
   MISSING tokens that are not reachable by walking. Check that in the same
   chunk.
2. **Vendored-grammar build route.** A `grammars/` directory with `.wasm`
   files, sha256s, a LICENSE copy and a build script (tree-sitter CLI 0.27.2,
   upstream tag + `grammar.js` diffs), copied to `dist/` by the build (the W1-C
   backlog item). The npm packages stay for the queries. The first content is
   the **Rust v0.24.2 release** `.wasm`, unchanged. This needs PR #13's tests to
   stop using `&raw` as their "valid but unreadable" trigger (9 places in 6
   test files, listed below). Use a gap that stays open, e.g.
   `char::<_, E>(…)` or `impl A + for<'a> B<'a>`. Owner decision needed: a
   checked-in binary built outside npm.
3. **Go patched grammar**: v0.25.0 + #202 + #198, gated by `compare.mjs` on
   restic and a Go corpus (0 broken / 0 changed today), and the Go module's
   tests for `new(expr)` and generic methods (a generic method is a new symbol
   shape for the Go module: receiver plus type parameters).
4. **Rust patched grammar**: v0.24.2 + #319 #271 #317 #312 #283 #281, gated
   the same way. Measured (`compare-rust-recommended.txt`): Vector 11 rejected
   files → 3; crates.io cache 1,705 fixed, 7 broken (only the `raw` ones from
   v0.24.x), 0 clean files with a changed tree.
5. **Error-site repairs** (`safe`, `unsafe extern` only if step 2 is not taken,
   Go `;`, Go final newline, macro-token `~`/`$`), with the rules and soundness
   conditions above, each reported as a repair in the file's diagnostics.
6. **Own grammar patches, one or two shapes per PR, in this order:** stacked
   parameter attributes, then primitive-named turbofish (Vector's last 3
   files), then `impl A + for<'a> B`, then the generic-argument shapes
   (generated code), then the where-clause and tuple-attribute shapes.
   Upstreaming each patch is optional.

## Notes for the follow-up chunks

- **Pin the corpus.** The corpus counts come from live checkouts and caches:
  Vector has since moved to `edfcf9000`, and restic now has 570 `.go` files.
  Follow-up chunks must gate on a pinned or exported corpus, not on whatever
  is checked out.
- **FFI test cases.** `unsafe extern` blocks with variadic declarations
  (`fn printf(fmt: *const c_char, ...)`) and with `#[link(...)]` are the common
  FFI shapes. They must be test cases in the grammar chunk.
- **Go `;` repair and labels.** Blanking an empty statement can re-attach a
  label (`L: ;` followed by `goto L` makes `L` label the next statement). This
  is harmless, and the repair chunk's soundness notes must name it.

## What I could not determine

- The validity of each crates.io file one by one. They are taken as valid
  because they are published. Each cause has a compiler-checked snippet. The
  cause rules are heuristics: 3 registry files stay unclassified (listed in
  `corpus-installed.txt`), and counts per cause are approximate.
- Whether the six "clean" Rust PRs are free of regressions beyond these
  corpora, and whether upstream will merge or change them. A vendored build
  must keep the compare gate.
- Whether `web-tree-sitter`'s callback length mismatch (it reports the whole
  string length but copies 5,119 units) has effects other than the surrogate
  split. None were seen.
- How common Go 1.27 generic methods will be: no corpus code uses them yet.
- The crates.io cache changed during the chunk (1,846 → 1,884 crate
  versions); the totals in different output files differ slightly.

## Dependency on PR #13

PR #13 (`src/graph/languages/rust/**`) uses the `&raw` gap on purpose, as a
file that rustc accepts and the grammar rejects, in
`test/graph-rust-round8/9/10/16/17.test.mjs` and
`test/fixtures/graph-rust/ancestor-block-path-cases.json`. Moving to any
grammar from v0.24.1 on makes those files clean, so those tests must switch
to a gap that stays open. Its error walk (`errorNode` in `parse.ts`) also
follows `children`, as `gaps.mjs` first did. In Go, a missing final newline yields a
MISSING token that a children walk does not reach. Whether the same can
happen in Rust was not seen in these corpora.
