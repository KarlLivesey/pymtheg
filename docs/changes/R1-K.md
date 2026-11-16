# R1-K: Rust links around project macros and imports

A user trial through MCP on ripgrep (178cc027e283, 102 Rust files) found that
every definite link was right, but 65% of links (22,647 of 34,780) were
unresolved and ordinary shapes were missing. This chunk measured why, then
fixed the three reported shapes and one cause the measurement found, each
only as far as it is sound. The Rust module's version goes from 26 to 27 (stored results
change). Nothing runs `cargo` or `rustc`; macros are still not expanded.

Evidence, scripts and samples: `evidence/r1-k/` (see its README).

## What the measurement showed (before)

`evidence/r1-k/measure.mjs` cold-indexes a project and classifies every
unresolved link by reason and by a rough target class. On main (module
version 26 of the Rust module):

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

**The change.** Only `#[macro_use] extern crate` can make a standard derive
opaque (a bare one: any name; a list: the listed names). The exact reason,
checked with rustc 1.98.1 (`evidence/r1-k/controls2/d1–d3`): on stable Rust a
`#[derive(Name)]` resolves among derive macros only, and those come from
proc-macro crates (imported by `use`, named by path, or brought in by
`#[macro_use] extern crate`) or the standard prelude. A `macro_rules!` macro
is function-like on stable: a `macro_rules!` derive or attribute (`derive()`
or `attr()` arms) is rejected with E0658 (issue 143549), and a bang
`macro_rules! Debug` in scope coexists with `#[derive(Debug)]` without
changing it (prints `7 X`). `#[macro_use] mod m;` carries only `macro_rules!`
macros, so it cannot change what a derive means. The existing checks on
`use` imports and globs of derive names are unchanged. Known limit: a nightly
crate that enables `macro_rules!` derives is not modelled.

Round 1 of this note said a same-named `macro_rules!` at a derive site does
not compile. That was false (review, Sol); the two reviewers had checked
different programs (a bang macro, which compiles; a declarative derive, which
is unstable). The statement above is the true one.

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
written in the transcriber (outside pattern positions, nested non-format
macro calls and nested `macro_rules!` definitions), and transitively in the
workspace macros it invokes, becomes a derived `calls` link at the
invocation's position (origin `analysis`, `data.macroBody`, `data.macro`
naming the definition). **The caller is the invocation site's enclosing
symbol, not an item the macro generates:** a call inside a `fn` the macro
defines is attributed to the module or function where the macro is invoked.
It is resolved as at the invocation: items at the call site, `$crate::` in
the defining crate (rustc agrees: `crate::f()` in an exported macro binds the
caller's `f`, `$crate::f()` the definer's; control `cross-crate`).

It is definite only when all of these hold:

- every macro on the way has one arm;
- every macro on the way has a *clean* expansion: no attribute anywhere (so
  no `#[cfg]` can remove the call) and no item other than a readable `use`
  (no `fn`, `mod`, `impl`, `const`, `static`, `macro_rules!`, …);
- every macro the expansion invokes is *harmless* where the outer macro is
  invoked: a standard or builtin macro no captured binding rebinds, or a
  readable workspace macro that is neutral and clean and invokes only
  harmless macros (transitive; anything unreadable fails closed);
- the call is not inside a `$( … )` repetition (it may be emitted zero
  times);
- nothing can rebind the head name: a `use` in an enclosing transcriber group
  (a glob withholds every name), a generic parameter at the call site, or,
  for a one-segment name, a local the arm binds or a local in scope where the
  macro is *defined* (a macro defined inside a function body: mixed-site
  hygiene resolves body locals at the definition).

Otherwise it is unresolved with would-be targets (`macro-arm-unverified`,
`macro-expansion-unverified`, `macro-repetition-unverified`,
`macro-body-name-unverified`), which `callers` reports as possible callers.
Calls with no workspace target, sysroot paths, `Self::` paths and method
calls in bodies are not derived. So `callers set_errored` reports `search`
at `main.rs:131` as a possible caller. In round 2 that link was definite;
under the round-3 name rule it is not, because of ripgrep's own `write!` and
`writeln!` macros (see Results). The calls inside test generators such as
ripgrep's `rgtest!` (a `#[test] fn` per invocation) are unresolved: the
expansion defines items under an attribute.

`rust.resolve` returns `{ resolutions, links }` when there are derived links
and the plain list otherwise; the Rust test harnesses accept both.

## The rule for macro links (round 3), in one paragraph

A call read from a macro is definite only if every property below holds for
the **whole path** from the invocation the user wrote down to the call,
through every nested macro invocation on the way. Each property is carried
transitively, never checked only at the outermost macro.

- **Readable.** Every macro on the path names exactly one readable workspace
  `macro_rules!` definition at that point, or is a standard or builtin macro
  (see the name rule below).
- **One arm.** Every such macro has a single arm (no arm selection to prove).
- **No local capture.** For a one-segment call name, no macro on the path is
  defined inside a function body (whose locals could capture it), and no arm
  on the path binds locals.
- **Clean.** Its emitted code is clean: no attribute anywhere and no item
  other than a `use`. Every macro the code invokes is harmless (neutral and
  clean, recursively; anything unreadable fails).
- **Not repeated.** No macro on the path sits inside a `$( … )` repetition.
- **Not inside a definition.** No macro on the path sits inside a nested
  `macro_rules!` definition.
- **No rebinding `use`.** No `use` in force on the path binds a name that
  heads a macro name invoked below it, or the call's head. A glob `use`
  binds every name.
- **The name rule.** A macro name counts as the standard (or builtin) macro
  only when no `macro_rules!`, proc macro, `use`/`extern crate` alias,
  `#[macro_use(…)]` entry or transcriber `use` *anywhere in the workspace*
  binds that name, and the existing per-site checks also pass.

Anything else is unresolved with its would-be targets. Calls in arguments
need, in addition, that every macro on the path forwards its whole input
unchanged as the tail of an argument list.

## Results

Round 3 runs on the merged tree (this branch with `origin/main` 379b6018)
against `origin/main`, both on the dev server in parallel
(`evidence/r1-k/*-summary.json`, `*-compare.txt`):

| | ripgrep before | ripgrep after | Vector before | Vector after |
|---|---|---|---|---|
| links (all) | 34,780 | 39,086 | 370,785 | 392,123 |
| definite | 12,121 | **13,689** | 78,624 | **79,034** |
| candidate sets | 12 | 12 | 100 | 100 |
| unresolved | 22,647 | 25,385 | 292,061 | 312,989 |
| links on main that went unresolved → definite | | 620 | | 95 |
| links on main that went definite → anything else | | **0** | | **0** |
| new calls in macro arguments: definite / unresolved | | 948 / 2,085 | | 315 / 20,571 |
| new derived macro-body calls: definite / unresolved | | 0 / 1,273 | | 0 / 452 |
| cold index, seconds (observation) | 42.6 | 43.1 | 626.7 | 587.0 |

**What the workspace-wide name rule costs:**

- **ripgrep.** It defines its own `macro_rules! write` (`crates/core/flags/doc/help.rs:19`,
  `man.rs:14`) and `macro_rules! writeln` (`man.rs:21`), wrappers that call
  `std::write!`/`std::writeln!` and unwrap. So `write` and `writeln` are no
  longer the standard macros anywhere in ripgrep. `eprintln_locked!` invokes
  both, which means it is not harmless and its forwarding into `writeln!` is
  unproved. Therefore `message!`, `err_message!` and `ignore_message!` are
  unproved too. As a result:
  - the `err_message!` argument calls are no longer proved forwarded;
  - the derived calls to `set_errored`, `messages` and `ignore_messages` are
    unresolved (with the would-be target kept);
  - definite body-call links fall from 16 to 0.

  Those wrappers are not in textual scope at any of those call sites (they
  live in `flags/doc` modules without `#[macro_use]`).
- **Vector.** Definite argument calls fall from 1,438 to 315, because these
  names are imported somewhere in the workspace:
  - `format`: `use super::{…, format, …}`, a workspace module;
  - `write`: `use nix::unistd::{…, write}`, a function;
  - `panic`, `vec`: `use std::{…, panic, …}` and `use std::vec`, std modules;
  - `assert_eq`: `use similar_asserts::assert_eq`, a real external macro, in
    60 files.

  Only the last can actually rebind the macro.

The other trial links stay definite: `eprint_nothing_searched()` and
`print_stats(…)` (`main.rs:144`, `:148`), the `Match` import and
`Match::new`, and `grep::searcher::SearcherBuilder::new()`.

Reasons on ripgrep (written links, before → after): `opaque-item-may-shadow-name`
on calls 849 → 227, on types 1,484 → 148, on imports 479 → 69, on patterns
271 → 30.

## Correctness sample

Round 3 (seeds ripgrep 7717, Vector 8803; `evidence/r1-k/sample-review.md`):
60 definite argument calls (30 per corpus), each read against the source:
**60 / 60 right.** There are no definite body-call links left in either
corpus to read. Round 2 (seeds 4409, 5521) read 105 links, all right; round 1
(seeds 1117, 2203) read 90, all right, but drew no Vector body-call links,
where the reviewers then found wrong ones.

Faults found and fixed so far:

- **Round 1, before review.** Found by the before/after diff: a module-level
  macro switched on the conservative binding facts for its whole file.
- **Round 1 review.** A nested item-defining macro; a definition-site local;
  `#[cfg]` in a body; a macro factory; a generated `mod`; and a false
  statement about derives.
- **Round 2 review.**
  - A `use … as println` in an expansion rebinding a nested macro name.
  - A project `println!` read as the standard one.
  - A repetition lost through a nested macro.
  - (Opus, rated exotic) An item-defining macro in a block inside format
    arguments. A brace block in macro arguments that invokes any macro
    directly is no longer read.

  These led to the path rule above, rather than to more case fixes.

## Compiler controls

`evidence/r1-k/controls/` (round 1) and `evidence/r1-k/controls2/` (round 2;
`run.sh`, output in `output.txt`, rustc 1.98.1 on the dev server) hold one
program per fixture case. Round 2 adds every review case and the further
ways an expansion can change a binding or a call's existence:

| Program | rustc prints | Pymtheg |
|---|---|---|
| nested `bind!()` defining `helper` (s1) | `2 2` | argument and body call unresolved |
| twin: nested harmless `note!()` | `note 1 1` | both definite |
| local at a function-local macro's definition (s2) | `2` | body call unresolved |
| twin: call-site local, module-level macro | `1` | body call definite |
| `#[cfg(any())]` on a body call (s3) / around forwarding | `end` / `end` | unresolved |
| twin: no cfg | `called` | definite |
| macro factory (s4) | `before verbosity` | no link at the factory invocation |
| generated `mod` with `super::`/`self::` (Opus a) | `43` | unresolved |
| `#[cfg(feature = "trace")]` in a body (Opus b) | `end` | unresolved |
| `let helper` in the body, forwarded `helper()` (h1) | `1` | definite (hygiene) |
| `let helper` in the body, body `helper()` | `2` | unresolved |
| `fn helper` in the body (h2), `const fn helper` (h5) | `2`, `3` | unresolved / no link |
| forwarding inside a closure and a `for helper` loop (h4) | `1 1` | definite |
| duplicated forwarding (h6) | `called 1 called 1` | definite |
| `stringify!`/`concat!` consuming tokens (h7) | `helper() x` | unresolved / no link |
| arm chosen by pattern (h8) | `2 1` | unresolved |
| recursive tt-muncher (h9) | `no call` | unresolved |
| `#[cfg(any())]` on the invoking statement (h10) | `end` | not definite |
| glob / named `use` in the body (h11, h12) | `2`, `2` | unresolved |
| `crate::` vs `$crate::` across crates | `crate:app dollar:a` | resolved the same way |
| derive controls (d1–d3) | `7 X`; E0658; E0658 | see shape 3 |

Round 3 adds `evidence/r1-k/controls3/` (rustc output in `output.txt`):

| Program | rustc prints | Pymtheg |
|---|---|---|
| `use crate::other as println` in the expansion: argument, body | `2`, `2` | unresolved |
| twin: a `use` binding no invoked macro name | `1` | definite |
| project `println!`: body, forwarding | `end`, `end` | unresolved |
| twin: standard `println!` in a body | `CALLED 1 end` | definite |
| repetition through a nested macro | `end` | unresolved |
| twin: no repetition | `1 end` | definite |
| attribute through a nested macro | `end` | unresolved |
| twin: no attribute | `called end` | definite |
| nested macro inside a generated definition | `end` | no link |
| function-local inner macro | `2` | unresolved |
| function-local outer macro (carried; conservative) | `1` | unresolved |
| unproven arm through a nested macro | `end` | unresolved |
| `use` in the outer expansion rebinding the inner macro's `println!` | `2` | unresolved |
| `def!()` in a block in `println!`/`assert!` arguments, and in an `if` block there | `2`, `ok`, `2` | no link |
| twin: the same blocks without a macro | `1 1` | definite |

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

Checks on the dev server after merging `origin/main` (60552338): `npm run
build`, full `npm test` 2,872 pass / 0 fail, `npm run format:check` clean,
`node scripts/spdx-tags.mjs --check` clean; the new source files carry the
SPDX tag.

Round 2 adds 24 fixture tests covering every control in `controls2/` (the table
above), each with the expectation rustc gave and, for each review finding, a
positive twin that must still resolve (harmless nested macro, call-site
local, no `cfg`, forwarding through a closure or loop, duplicated
forwarding).

Round 3 adds 17 fixture tests covering every program above.

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
  crate` can make a standard derive opaque. Why: `macro_rules!` macros are
  function-like, and a derive position resolves among derive macros only, so
  a same-named `macro_rules!` never competes with a derive.
- **Statement macros proved neutral (R1-K):** a readable workspace
  `macro_rules!` macro whose arms emit no item, statement `let`, attribute or
  statement-position `tt`/`item`/`stmt` at the top level, and call only
  neutral macros there, does not make its block opaque. A captured
  `macro_rules!` named like a standard macro competes only in textual scope.
- **Macro arguments and bodies (R1-K):** argument calls are definite only
  through a standard format macro or whole-input `tt` forwarding into one;
  body calls are derived at each invocation, definite only for one-arm
  macros with no possible rebinding of the head name.
