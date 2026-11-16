# R1-K correctness samples: hand review

Samples come from `compare.mjs` (mulberry32), printed in
`ripgrep-compare.txt` and `vector-compare.txt`. Each link was checked by
reading the call site and the target's definition, and, where the target is
reached through an import, alias, `cfg` variant, module path or macro body,
that route, in the pinned sources on the dev server.

## Round 4 (current; seeds ripgrep 9931, Vector 6247, Vector std-named files 5113)

| Draw | Links | Right |
|---|---|---|
| ripgrep, unresolved → definite | 15 | 15 |
| ripgrep, new argument calls | 30 | 30 |
| ripgrep, body calls (all 16 that exist) | 16 | 16 |
| Vector, unresolved → definite | 15 | 15 |
| Vector, new argument calls | 15 | 15 |
| Vector, argument calls in the 93 files that define or import a std-named macro or `similar_asserts::assert_eq` (`std-named-files.sh`, `sample-files.mjs`; 61 such links, 25 drawn) | 25 | 25 |

That is 116 drawn and 115 distinct (`parquet.rs:688` drawn twice); all right.

- **Body calls.** `err_message!`, `message!` and `ignore_message!` at
  `main.rs:131, 193, 210, 415`, `haystack.rs:38, 52`, `hiargs.rs:882` and
  `flags/config.rs:35, 44`. Each body has one arm and calls exactly those
  functions. The name rule proves `write!`/`writeln!` std's at each site:
  ripgrep's own wrappers live in `flags/doc` modules, out of textual scope
  there.
- **ripgrep argument calls.** Test helpers in the same `tests` module
  (`m`, `mkpaths`, `lines`, `prev`, `s`, `check`, `roundtrip_err`,
  `sparse_except`, `e`, `E`, `exact`), `escape`/`unescape`
  (`use super::{escape, unescape}`, or the test fn `escape` with
  `use super::escape`), `super::parse_excludes_file`, `PatternSource::File`
  and `Mode::*` (imported from `lowargs` in `defs.rs`), and `walk` (bench fn).
- **Vector std-named files.** These files import `similar_asserts::assert_eq`
  (`opentelemetry-proto/…/legacy/tests.rs`, `file-source-common/…/checkpointer.rs`)
  or `std::{…, vec}` (`dnstap-parser/src/parser.rs`), or match only through
  a `…::write::…` or `…::format::…` path segment that binds nothing of that
  name. Every sampled call sits in a macro that is std's own at that site:
  `vec!` (never rebound there), or `assert!`/`assert_eq!` in files without
  the `similar_asserts` import. The checkpointer and legacy-tests calls are
  inside `vec![…]`, not inside the imported `assert_eq!`.
- **Vector other routes.** `RustToolchainConfig::rust_version` via
  `use super::config::{…, RustToolchainConfig}`; `typed_event_with_metadata`
  via `use super::{… test_support::{…}}`; `FileFingerprint::*` via
  `use super::{…, fingerprinter::FileFingerprint}`; nested test fns in the
  dnstap parser tests; the rest same-file functions.

## Round 3 (seeds ripgrep 7717, Vector 8803)

60 definite argument calls, 30 per corpus, each read against the source:
60 / 60 right. No definite body-call links exist in either corpus under the
round-3 rule (see `docs/changes/R1-K.md`, Results), so none could be read.

Routes checked beyond same-file test helpers:

- ripgrep `is_hidden_path`, `file_name` (`ignore/src/pathutil.rs` tests:
  `use super::{file_name, is_hidden_path}`); `escape` in `globset` (inside
  the test fn `escape` with `use super::escape`) and in `cli/src/escape.rs`
  tests; `HyperlinkFormat::empty` (associated fn in the same file);
  `self.multi_line()` (`&self` method of `StandardImpl`, called from a
  `&self` method).
- Vector `test_one_timestamp_parse`: a fn nested in the test fn that calls
  it. `git::current_branch`: `use crate::utils::git;`.
  `check_value_nesting_cost`: imported from `event/ser.rs`. `all_gauges`:
  `use super::{super::{…, tests::{all_gauges, …}}}`. `validate_headers`:
  imported from `config`. `Request::encoded`: `impl Request` in the same
  `tests` module. `self.drain_until(…)`: called on `self: &mut Self` from
  `publish_and_expect(&mut self)`, with `drain_until(&mut self)`.

## Round 2 (seeds ripgrep 4409, Vector 5521)

| Corpus | Unresolved → definite | New argument calls | Body calls | Distinct links | Right |
|---|---|---|---|---|---|
| ripgrep | 15 | 29 | 16 (all that exist) | 60 | 60 / 60 |
| Vector | 15 | 30 | 0 (none exist) | 45 | 45 / 45 |
| **Total** | **30** | **59** | **16** | **105** | **105 / 105** |

ripgrep's 30-link "new definite" draw included one body call
(`crate::messages::ignore_messages` at `hiargs.rs:882`) that is also in the
body-call draw; it is counted once. Only 16 definite body-call links exist
across both corpora after the review fixes, so all were read.

Body calls (all 16): `err_message!` (→ `crate::messages::set_errored`, and
through `message!` → `crate::messages::messages`), `message!` (→
`crate::messages::messages`) and `ignore_message!` (→
`crate::messages::messages`, `crate::messages::ignore_messages`) at
`main.rs:131, 193, 210, 415`, `haystack.rs:38, 52`, `hiargs.rs:882` and
`flags/config.rs:35, 44`. Each body (`crates/core/messages.rs`) has one arm
and calls exactly these functions.

Routes checked beyond same-file names:

- ripgrep `escape` at `globset/src/lib.rs:1322`: inside the test fn
  `tests::escape`, whose body has `use super::escape;`; the link goes to the
  crate-root `escape`, as rustc binds.
- ripgrep `crate::sinks` (searcher `glue.rs:1496`): re-exported by
  `pub use crate::{…}` in `searcher/src/lib.rs`.
- ripgrep `ctx.bytes()` (`ctx: &SinkContext<'_>`), `range.end()` (`range: &Range`,
  `type Range = Match`), `self.wtr()` (`&self` method in `StandardImpl`).
- ripgrep test helpers `e`, `E`, `I`, `exact`, `seq`, `prev`, `m`,
  `replace_str`, `sparse`, `b`, `matchedf` called in `assert!`/`assert_eq!`
  arguments: defined in the same `tests` module; `escape`/`unescape` in
  `cli/src/escape.rs` via `use super::{escape, unescape}`.
- Vector `super::metrics::decode_v3_metric_data`: `metrics.rs` has
  `mod v3; pub(crate) use v3::decode_v3_metric_data;`.
- Vector `random_string` (nats, mqtt, kafka tests) and `get_distribution`
  (statsd normalizer): imported from `crate::test_util`.
- Vector `process_log` (elasticsearch tests): `use … sink::process_log`.
- Vector `humio_address` at `humio/logs.rs:568`: inside `mod integration_tests`.
- Vector `LazyCustomAttribute::kv`: `impl LazyCustomAttribute` in the same file.
- Vector `send_trace`: a fn nested in `send_agent_traces`, called there.
- Vector `offset_file_id` (ledger tests: `use super::{offset_file_id, …}`),
  `to_pretty_json` (web-playground tests: `use super::*`).
- Vector `disk_v2/tests` helpers: imported from `super` and `crate::…::tests`, as in round 1.

## Round 1 (seeds ripgrep 1117, Vector 2203)

90 links (30 unresolved → definite and 15 new definite per corpus), all
right. That draw contained no Vector body-call links; the review found 7
wrong ones there (`verbosity` from `define_display_macro!`) and the wrong
shapes listed in `docs/changes/R1-K.md`. Round 2's rules remove them.
