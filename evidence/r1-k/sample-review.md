# R1-K correctness sample: hand review

Samples come from `compare.mjs` (mulberry32; ripgrep seed 1117, Vector seed
2203), printed in `ripgrep-compare.txt` and `vector-compare.txt`. Each link
was checked by reading the call site and the target's definition (and, where
the target is reached through an import, alias, `cfg` variant or module path,
that route) in the pinned sources on the dev server.

| Corpus | Unresolved → definite (written links) | New definite (argument calls, derived body calls) | Right |
|---|---|---|---|
| ripgrep | 30 | 15 | 45 / 45 |
| Vector | 30 | 15 | 45 / 45 |
| **Total** | **60** | **30** | **90 / 90** |

No wrong link was found.

Routes checked beyond same-file names:

- ripgrep `Range::new`, `Range::zero`, `range.end()`, `range.start()` in
  `searcher/core.rs`: `Range` is `type Range = Match;` in
  `searcher/mod.rs`; `range: &Range` with `end(&self)`/`start(&self)` is a
  first-step probe.
- ripgrep `mat.lines()`: `mat: &SinkMatch<'_>`, `lines(&self)`.
- ripgrep `grep::matcher::LineTerminator::crlf`, `grep::searcher::MmapChoice::auto`,
  `grep::cli::hostname`, `grep::cli::StandardStream`: through the `grep`
  facade's `pub extern crate grep_x as x;`.
- ripgrep `crate::util::setup` / `setup_pcre2` [derived]: the single arm of
  `rgtest!` (`tests/macros.rs`) calls them; the invocation is at module level,
  so the source is the file.
- ripgrep argument calls `e`, `I`, `seq`, `exact`, `prev`, `m`, `matchedf`,
  `walk`: test helpers in the same `tests` module (or file) as the
  `assert!`/`assert_eq!` site.
- Vector `MAX_FILE_ID` in `disk_v2/tests/invariants.rs`: resolves to the
  `#[cfg(test)]` constant (`common.rs:48`), not the `#[cfg(not(test))]` one.
- Vector `create_default_buffer_v2`, `create_buffer_v2_with_write_buffer_size`
  in `invariants.rs`: imported by `use crate::{… tests::{…}}`, not by the
  `use super::{…}` line; `read_next`, `read_next_some`,
  `create_buffer_v2_with_max_data_file_size` by `use super::{…}`.
- Vector `build_healthcheck`, `get_token` in `splunk_hec/common/util.rs:455`:
  inside `mod integration_tests`, which imports both from `super`.
- Vector `get_aggregated_histogram` (normalizer tests) via
  `use crate::test_util::metrics::{…}`; `all_counters` (host_metrics
  `network.rs` tests) via `use super::super::tests::{all_counters, …}`.
- Vector `TestRunner as _` imports resolve to the `TestRunner` trait.
