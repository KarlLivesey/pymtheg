# R1-K: Rust links around project macros and imports

A user trial through MCP on ripgrep (178cc027e283, 102 Rust files) found that
every definite link was right, but 65% of links (22,647 of 34,780) were
unresolved and ordinary shapes were missing. This chunk measured why, then
fixed the three reported shapes and one cause the measurement found, each
only as far as it is sound. Rust module version 26 → 27 (stored results
change). Nothing runs `cargo` or `rustc`; macros are still not expanded.

Evidence, scripts and samples: `evidence/r1-k/` (see its README).

## What the measurement showed (before)

`evidence/r1-k/measure.mjs` cold-indexes a project and classifies every
unresolved link by reason and by a rough target class. On main (module
version 26):

| | ripgrep | Vector |
|---|---|---|
| links (all) | 34,780 | 370,785 |
| definite / candidates / unresolved | 12,121 / 12 / 22,647 | 78,624 / 100 / 292,061 |
| unresolved: head is a local, parameter or generic | 4,561 | 45,497 |
| unresolved: standard-library or external path | 1,548 | 23,378 |
| unresolved: no workspace symbol has that name (mostly std methods and macros) | 6,745 | 53,480 |
| unresolved: workspace would-be targets, or a workspace name | 9,793 | 169,659 |

In ripgrep, the workspace-internal part was dominated by dot calls whose
receiver type is not written (`receiver-type-unverified`, about 5,000; type
inference, out of scope) and by `opaque-item-may-shadow-name` (about 3,000
workspace links across calls, types, imports and patterns). Tracing where
that opacity came from (a temporary hook on the resolver's opaque-scope set)
gave one cause behind most of it, below, and the macro shapes the trial
reported. In Vector the same classes are much larger and two further causes
dominate: its three files the grammar cannot read (`failed-file-unseen-declarations`
on about 52,000 workspace links) and attribute and external-macro opacity
(listed under backlog).

## Shape 3 first: one cause behind most of it

**What it was.** `use grep_matcher::{LineTerminator, Match}` in
`crates/searcher/src/lines.rs` was unresolved (`opaque-item-may-shadow-name`),
and so were `Match::new`, `grep::searcher::SearcherBuilder::new` in
`crates/core/flags/hiargs.rs` and most other links in those crates.

**The rule that produced it.** A `#[derive(...)]` is treated as able to emit
items when any of its derives is not a standard one, *or when the crate has
any `#[macro_use]` attribute anywhere*, on the reasoning that `macro_use` could
bring in a derive macro named `Debug`. The opaque derive then makes its whole
module opaque, so every name lookup that passes through that module is
withheld. ripgrep's `searcher` and `printer` crates have
`#[macro_use] mod macros;`, and its binary has `#[macro_use] mod messages;`.

**The change.** Only `#[macro_use] extern crate` can bring a derive into
scope (a bare one: any name; a list: the listed names). `#[macro_use] mod m;`
carries `macro_rules!` macros only, and a `macro_rules!` macro cannot be used
as a derive: one named like a standard derive in scope at a derive site is a
compile error, so it never retargets code that builds.

**The other two parts of shape 3 needed nothing else.** With the module no
longer opaque, `Match::new` resolves, and so does the facade path
`grep::searcher::SearcherBuilder::new` through
`pub extern crate grep_searcher as searcher;` (that route already worked;
the opaque module hid it). `symbol grep::searcher::SearcherBuilder` is a
qualified-name query in MCP, which is outside this chunk; the link itself
now resolves.

**What stays unresolved, and why.** `range.start()` on a parameter
`range: Match` (owned) where `start` takes `&self`: that is a later probe step
(autoref), and an in-scope trait method taking `self` by value at the first
step would win. Proving none exists needs every in-scope trait's methods,
including standard-prelude and external traits; that is method resolution
beyond this chunk, so it stays unresolved with `later-probe-step` and the
would-be target. The same call on `range: &Match` is definite.

## Shape 2: one project macro made sibling calls unresolved

**What it was.** In `search` (`crates/core/main.rs`), `err_message!(...)`
made `eprint_nothing_searched()` (line 144) and `print_stats(...)` (148)
unresolved, while the same call in `search_parallel` was definite.

**The rule that produced it.** Any macro invoked as a statement of a block,
other than the twenty standard statement macros and the audited ecosystem
macros, marks the block opaque: its expansion might define an item named like
any sibling lookup.

**The change.** Every statement-level invocation is now a candidate that the
resolver must prove harmless where it is invoked, using the existing
exemption path (the conservative binding facts are kept on each link and
applied when the proof fails). A workspace `macro_rules!` macro is proved
harmless when the invocation names exactly that definition and every arm is
readable and has, at the top level of its transcriber: no item keyword
(`fn`, `struct`, `enum`, `union`, `trait`, `impl`, `mod`, `use`, `extern`,
`const`, `static`, `type`, `macro_rules`, `macro`), no statement `let`
(`if let`, `while let` and let chains are fine), no attribute, no
`tt`/`item`/`stmt` fragment, no metavariable used as a macro name, and only
macro calls that are themselves proved harmless at the same site. Tokens in a
brace group of the transcriber are their own block and do not count. Macro
names in a transcriber are looked up at the call site, as rustc does;
`$crate::` paths in the defining crate.

A standard macro name that a workspace macro rebinds (ripgrep's own `write!`
and `writeln!` in `flags/doc/`) is judged as that workspace macro. And a
captured `macro_rules!` named like a standard macro now affects a standard
invocation only where it is in textual scope (or reached by a path or
import); before, any such definition anywhere in the project made every use
of that standard name opaque.

**What stays as before.** Macros that are not readable workspace
`macro_rules!` (another crate's unexported macro, external macros other than
the audited ones), macros that define items, forward `tt` into statement
position or bind `let`, keep today's behaviour. Standard statement macros
were already harmless and still are.

## Shape 1: calls inside a project macro invocation

**What it was.** `err_message!("{}: {}", haystack.path().display(), err)`
gave `haystack.path()` no link, and `callers set_errored` found nothing,
although `err_message!`'s body calls `crate::messages::set_errored()`.

**The rule that produced it.** The parser emits no links for anything inside
a macro invocation's tokens ("Macro arguments get no links"), and nothing
attributes the calls written in a macro's body to the places it is invoked.

**Arguments: the change.** Calls written in an invocation's argument tokens
are now links, read as a format-style list (pieces split at `,`, and `;` for
`vec!`; each an expression or `name = expression`; only the first piece of
`matches!`). A piece containing a closure, `let`, `match`, `for`, `while`,
`loop`, an item keyword, `=>`, a label or a metavariable is skipped whole. A
link is resolved by the ordinary rules for a call at that place only when the
invocation provably evaluates the tokens as expressions at the call site:

- a standard format macro (`print`, `println`, `eprint`, `eprintln`,
  `format`, `format_args`, `write`, `writeln`, `panic`, `todo`,
  `unreachable`, `unimplemented`, the `assert` and `debug_assert` forms,
  `dbg`, `vec`) that passes the same checks as the statement exemption; or
- a workspace `macro_rules!` macro whose every arm matches `$($x:tt)*` (or
  nothing) and passes all of it, unchanged, as the tail of the argument list
  of a standard format macro or of another such macro (ripgrep's
  `err_message!` → `message!` → `eprintln_locked!` → `writeln!`).

A name bound by an item in a transcriber group around that forwarding
(`use std::io::Write;` in `eprintln_locked!`) is not resolved as the head of
such a call. Every other argument call is unresolved with its would-be
targets and `macro-argument-unverified` (for example inside `tracing::info!`,
`serde_json::json!`, or a workspace macro with `$x:expr` matchers, whose
arms would need a matcher to read). Method calls in arguments follow the
existing dot-call rule; `haystack.path()` stays unresolved because
`haystack` has no written type.

**Body calls: the change (attribution, not just recording).** For each
invocation that names one readable workspace definition, each path call
written in the transcriber (outside nested non-format macro calls and
pattern positions), and transitively in the workspace macros it invokes,
becomes a derived `calls` link from the invoking item at the invocation's
position (origin `analysis`, `data.macroBody`, `data.macro` naming the
definition). It is resolved as at the invocation: call-site names, and
`$crate::` in the defining crate. It is definite only when every macro on the
way has one arm and nothing in the expansion can rebind the head name (an
item in an enclosing transcriber group, a generic parameter at the call site,
or a local the arm binds for one-segment names); `crate::` and `::` paths
cannot be rebound. Otherwise it is unresolved with would-be targets
(`macro-arm-unverified`, `macro-body-name-unverified`), which `callers`
reports as possible callers. Calls with no workspace target, sysroot paths,
`Self::` paths and method calls in bodies are not derived. So
`callers set_errored` now returns `search` at `main.rs:131` (definite), and
`requirements_for … impact` can follow it.

`rust.resolve` returns `{ resolutions, links }` when there are derived links
and the plain list otherwise; the Rust test harnesses accept both.

## Results

Final runs, this branch (module version 27) against main, same machine
(`evidence/r1-k/*-summary.json`, `*-compare.txt`):

| | ripgrep before | ripgrep after | Vector before | Vector after |
|---|---|---|---|---|
| links (all) | 34,780 | 39,089 | 370,785 | 392,474 |
| definite | 12,121 | **14,385** | 78,624 | **80,187** |
| candidate sets | 12 | 12 | 100 | 100 |
| unresolved | 22,647 | 24,692 | 292,061 | 312,187 |
| links on main that went unresolved → definite | | 620 | | 95 |
| links on main that went definite → anything else | | **0** | | **0** |
| new calls in macro arguments: definite / unresolved | | 962 / 2,074 | | 1,438 / 19,792 |
| new derived macro-body calls: definite / unresolved | | 682 / 591 | | 30 / 429 |
| cold index, seconds (observation) | 48.9 | 54.8 | 622.1, 679.9 | 771.2 |

Unresolved goes *up* because calls inside macro arguments are now links at
all; the ones that cannot be proved (most in Vector are inside
`tracing`/`similar_asserts`/`serde_json` macros) are honest unresolved links
with would-be targets, where before there was no link. On the links that
existed on main, unresolved fell (ripgrep 22,647 → 22,027) and nothing
definite was lost.

Reasons on ripgrep (written links, before → after, from
`ripgrep-compare.txt`): `opaque-item-may-shadow-name` on calls 849 → 227, on
types 1,484 → 148, on imports 479 → 69, on patterns 271 → 30.

The trial's specific links, ripgrep after:

| Link | Before | After |
|---|---|---|
| `main.rs:131` `err_message!` → body call `crate::messages::set_errored` (from `search`) | none | definite |
| `main.rs:131` → transitive body call `crate::messages::messages` | none | definite |
| `main.rs:131` argument `haystack.path()` | none | unresolved, `receiver-type-unverified` (`haystack` has no written type); the macro forwarding itself is proved |
| `main.rs:144` `eprint_nothing_searched()` | unresolved (opaque) | definite |
| `main.rs:148` `print_stats(…)` | unresolved (opaque) | definite |
| `lines.rs:7` `use grep_matcher::{…, Match}` | unresolved (opaque) | definite |
| `lines.rs:81`, `:146` `Match::new` | unresolved (`too-many-targets`) | definite |
| `lines.rs:137…` `range.start()` / `range.end()` on `range: Match` | unresolved | unresolved, `later-probe-step` (see shape 3) |
| `hiargs.rs:719` `grep::searcher::SearcherBuilder::new()` | unresolved | definite |

Index time rises by about 12% on ripgrep and 13–24% on Vector (main was
measured twice there, 622 s and 680 s, under different load); the extra work
is reading argument tokens and proving macros per invocation. These are
observations on a shared machine, not limits.

## Correctness sample

At least 60 links that went from unresolved to definite, plus new definite
links, drawn at random (`compare.mjs`, mulberry32, ripgrep seed 1117, Vector
seed 2203) and each read against the source on the dev server
(`evidence/r1-k/sample-review.md`):

| | unresolved → definite | new definite (arguments, body calls) | right |
|---|---|---|---|
| ripgrep | 30 | 15 | 45 / 45 |
| Vector | 30 | 15 | 45 / 45 |

All 90 are right, including routes through a type alias (`type Range =
Match`), the `grep` facade, a `#[cfg(test)]` constant with a non-test twin,
and imports from `super` and `crate::…::tests`.

One fault was found and fixed before this sample, by the before/after diff
rather than the sample: an earlier version lost 5 definite Vector links
(`config.type_name()` in `vector-config`'s `schema/helpers.rs`, and test
calls to `merge` in `transforms/reduce/merge_strategy.rs`). A module-level
macro that could not be proved neutral switched on the conservative binding
facts for every link in its file, although a module-level macro cannot bind
a function's locals. The binding fallback now applies only below a block
statement (regression test: "an unproved module-level macro does not
unsettle locals in functions"). The final runs above lose no definite link.

## Compiler controls

`evidence/r1-k/controls/` holds a program for each kind of fixture case
(`run.sh`, output in `output.txt`, rustc 1.98.1 on the dev server). All
compile. The two negative ones show the danger the rules avoid: with an
item-defining macro in the block, `helper()` calls the macro's `helper` (the
program prints 2), and a forwarding macro that defines `helper` around its
arguments makes the forwarded `helper()` call that one (prints 2). Both stay
unresolved here.

## Tests

`test/graph-rust-r1k-macros.test.mjs`: each shape, positive and negative —
neutral and item-defining macros, `tt` forwarded to statement position, a
`let` in the body, an unreadable nested macro, a metavariable as macro name,
a macro in another crate without `#[macro_export]`, the ripgrep messages
chain, standard names rebound by neutral and item-defining macros, a
same-named macro out of textual scope, `if let` in a body, format arguments
(including `name =`, `assert_eq!`, `vec![x; n]`, `matches!`), forwarding,
unknown macros, stringified tokens, an item around forwarded arguments,
closures in arguments, a local closure named like a function, multi-arm and
local-binding body calls, `$crate` body calls across crates, `macro_use` on a
module versus a bare `macro_use extern crate`, two glob-imported `Match`
types, an inner import shadowing an outer one, and a facade
`pub extern crate … as …` path.

Changed expectations: `recall-4.json` "brace tail is still statement-capable"
used `macro_rules! m{()=>{{}}}`, which expands to an empty block and is now
proved harmless; the case now uses an item-defining body so it still tests a
brace tail. The Rust sample conformance gains one derived link (the body call
of `local_macro!` at its invocation in `run`, unresolved there because
`external_macro!` is opaque).

## Not done (backlog)

- **Receiver types (largest remaining class).** Dot calls on a receiver
  with no written type: about 6,300 workspace links on ripgrep and 63,000 on
  Vector. Needs type inference or the toolchain route (D17).
- **`later-probe-step`** (ripgrep 131): `x.m()` where `x: T` is owned and `m`
  takes `&self`. Proving no in-scope trait has a by-value `m` needs the
  method names of every in-scope trait, including the standard prelude's and
  external crates'.
- **Vector's failed files.** Three files the grammar cannot read
  (`lib/codecs/tests/avro.rs`, `lib/prometheus-parser/src/line.rs`,
  `lib/tracing-limit/src/lib.rs`) make about 52,000 workspace links
  `failed-file-unseen-declarations`; a grammar fix (W2-P/W2-V line of work)
  would recover most of them.
- **Opaque scopes in Vector by cause** (one re-resolution with a temporary
  hook; counts are scopes, not links): `assert_eq` 685 (60 files import
  `similar_asserts::assert_eq`, an unaudited external macro; auditing
  `similar_asserts` and `pretty_assertions` in the ecosystem catalogue, as
  was done for `tracing`, is the cheap fix), non-standard `derive` 647,
  `#[test]` 411 and `#[tokio::test]` 179, `tracing` `error`/`debug`/`info`/
  `warn`/`trace` about 930 (why these are not proved by the existing
  ecosystem audit in Vector is not yet known; worth one investigation),
  `#[configurable_component]` 169, `impl_generate_config_from_default!` 72.
- **Workspace macros with `$x:expr` matchers.** Their argument calls stay
  `macro-argument-unverified`; reading them needs a `macro_rules!` matcher.
- **MCP `symbol grep::searcher::SearcherBuilder`.** The link resolves; finding
  a symbol by a re-exported path is a query feature outside this module.

## Decision ledger entries proposed

The ledger is outside this chunk's files (R1-J is editing docs); proposed
entries for the manager:

- **Derives and `macro_use` on modules (R1-K):** only `#[macro_use] extern
  crate` can make a standard derive opaque. Why: `macro_rules!` cannot serve
  as a derive; a same-named one at a derive site does not compile.
- **Statement macros proved neutral (R1-K):** a readable workspace
  `macro_rules!` macro whose arms emit no item, statement `let`, attribute or
  statement-position `tt`/`item`/`stmt` at the top level, and call only
  neutral macros there, does not make its block opaque. A captured
  `macro_rules!` named like a standard macro competes only in textual scope.
- **Macro arguments and bodies (R1-K):** argument calls are definite only
  through a standard format macro or whole-input `tt` forwarding into one;
  body calls are derived at each invocation, definite only for one-arm
  macros with no possible rebinding of the head name.
