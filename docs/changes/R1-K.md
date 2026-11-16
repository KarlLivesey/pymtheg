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
in the reason of 85,203 unresolved workspace links) and attribute and external-macro opacity
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

## The rule for macro links (round 4)

**Path properties.** A call read from a macro is definite only if every one
of these holds for the whole path, from the invocation the user wrote down to
the call, through every nested macro on the way. Each is carried
transitively.

- **Readable.** Every macro on the path names exactly one readable workspace
  `macro_rules!` at that point, or is the standard (or builtin) macro under
  the name rule below.
- **One arm.** Every macro on the path has a single arm.
- **Clean.** Its emitted code has no attribute and no item other than a
  `use`. Every macro it invokes is harmless (neutral and clean,
  recursively); anything unreadable fails.
- **Not repeated.** Nothing on the path sits inside a `$( … )` repetition.
- **Not inside a definition.** Nothing on the path sits inside a nested
  `macro_rules!` definition.
- **No local capture.** For a one-segment name, no macro on the path is
  defined inside a function body or binds locals.
- **No rebinding `use`.** No `use` in force on the path binds a name that
  heads a macro invoked below it, or the call's head.
- **Arguments.** Argument calls also need every macro on the path to pass
  its whole input on unchanged. A brace block in the arguments that invokes
  any macro is not read.

**The name rule.** A bare name `n` written at a point P (a transcriber name
counts as written at the invocation site: rustc looks it up there, controls
`c1`–`c3`) is the standard or builtin macro only if all of these hold:

1. **Availability.** The standard macro is available at P (no `no_std`
   without std, no `#![no_implicit_prelude]`).
2. **No proc macro or named import.** No proc macro and no
   `#[macro_use(n)]` entry anywhere in the project is named `n`.
3. **Textual scope (fails closed on unseen).** No `macro_rules! n` is in
   textual scope at P, and no textual-scope entry is unseen.
   - In scope means earlier in the file in P's module, block or function or
     an enclosing one, inherited by a child module file at its `mod`
     declaration, or carried by `#[macro_use] mod`.
   - Unseen means a failed file in a `#[macro_use]` chain.
4. **`#[macro_use] extern crate`.** In P's crate, no `#[macro_use] extern
   crate` covers `n`.
   - One for a crate outside the workspace fails closed.
   - One for a workspace crate fails if that crate exports `n`.
   - `#[macro_use] extern crate std/core/alloc` is std's own.
5. **Explicit `use` items.** No explicit `use … n` or `use … as n` in P's
   block, function or module, or an enclosing one, binds a macro. Each is
   resolved in the macro namespace:
   - `use std::n` (or `core`, `alloc`) is std's own and does not rebind;
   - a workspace path that resolves completely to no macro does not rebind
     (a function, a module: `use nix::…::write` is external, see below;
     `use super::format` is a module);
   - a path into a crate outside the workspace fails closed;
   - anything unresolved fails closed.
6. **No item of the module.** No item of P's module is a macro named `n`,
   for example a crate-root `#[macro_export] macro_rules! n` or a
   `pub(crate) use … as n` re-export. Ordinary path lookup decides.
7. **Globs are not consulted.** A glob that would bring in a macro named
   like a standard prelude macro is an ambiguity error (E0659) in every
   shape tried: crate root, child module, block, workspace, builtin and
   external target (`controls4/glob`, g1–g10). So in code that compiles a
   glob never rebinds one. The two shapes that do compile are already
   covered: a crate-root `#[macro_export]` item (point 6) and a textual
   `macro_rules!` (point 3). **This departs from the brief's "fail closed
   on a glob whose target you cannot enumerate"** on the strength of those
   controls.

`std::n!` paths are std's own unless `std` itself is rebound.

**`#[macro_export(local_inner_macros)]` (round 5).** In such a macro rustc
reads every bare macro name in the transcriber as `$crate::name`, standard-
looking names included. Rather than model that, a macro exported this way
that invokes any macro by a bare name proves nothing: it is not neutral, not
clean, not forwarding, and its nested macros are not followed. Neither
ripgrep nor Vector uses `local_inner_macros`.

**Where the earlier E4 ruling still applies.** The statement-opacity
exemption (does `println!();` hide sibling names?) keeps that ruling: unseen
code is assumed not to define a standard-named macro. Its import check now
resolves explicit imports the same way (point 5).

## Results

Round 5 runs on this branch (its merge with `origin/main` c2edd086 adds only a ledger line)
against `origin/main`, both on the dev server in parallel
(`evidence/r1-k/*-summary.json`, `*-compare.txt`):

| | ripgrep before | ripgrep after | Vector before | Vector after |
|---|---|---|---|---|
| links (all) | 34,780 | 39,086 | 370,785 | 392,123 |
| definite | 12,121 | **13,719** | 78,624 | **79,082** |
| candidate sets | 12 | 12 | 100 | 100 |
| unresolved | 22,647 | 25,355 | 292,061 | 312,941 |
| links on main that went unresolved → definite | | 620 | | 95 |
| links on main that went definite → anything else | | **0** | | **0** |
| new calls in macro arguments: definite / unresolved | | 962 / 2,071 | | 363 / 20,523 |
| new derived macro-body calls: definite / unresolved | | 16 / 1,257 | | 0 / 452 |
| cold index, seconds (observation) | 42.7 | 45.7 | 631.6 | 659.6 |

**The trial links on ripgrep all resolve:**

- `crate::messages::set_errored` and `messages`: definite callers at
  `main.rs:131`, `193`, `210`, `415` and `haystack.rs:38`.
- `ignore_messages`: definite callers at `haystack.rs:52` and `hiargs.rs:882`.
- `err_message!` arguments: proved forwarded. `haystack.path()` stays
  unresolved only for `receiver-type-unverified`.
- `eprint_nothing_searched()`, `print_stats(…)`, the `Match` import and
  `Match::new`, `grep::searcher::SearcherBuilder::new()`: definite.

ripgrep's own `write!`/`writeln!` (`flags/doc`) are not in textual scope at
those sites, and nothing imports them there, so std's are proved.

**Why Vector gains little from argument calls (363 definite).** The name
rule fails closed at most Vector sites for one reason:

- `#[macro_use] extern crate tracing;` (with `derivative` and `cfg_if`) at
  the root of the main crate and of `vector-core`, `vector-common`,
  `vector-buffers`, `vector-stream` and `vector-tap` (point 4). Those crates
  are outside the workspace, so whether they export a macro named `vec` or
  `format` cannot be read. A temporary trace on one re-resolution confirmed
  it is the failing check for every standard name there.
- Elsewhere `use similar_asserts::assert_eq` correctly fails point 5, and
  unseen textual entries from Vector's three unparsed files fail point 3.

Recovering these sites would need audited export lists for those three
crates, as the existing catalogue does for `tracing`'s statement macros.
That is backlog, not done here.

Reasons on ripgrep (written links, before → after): `opaque-item-may-shadow-name`
on calls 849 → 229, on types 1,484 → 148, on imports 479 → 69, on patterns
271 → 30.

## Correctness sample

Round 4, fresh seeds (`evidence/r1-k/sample-review.md`), each read against
the source:

| | Links | Right |
|---|---|---|
| ripgrep, unresolved → definite (seed 9931) | 15 | 15 |
| ripgrep, new argument calls (seed 9931) | 30 | 30 |
| ripgrep, body calls: all 16 that exist | 16 | 16 |
| Vector, unresolved → definite (seed 6247) | 15 | 15 |
| Vector, new argument calls (seed 6247) | 15 | 15 |
| Vector, argument calls in the 93 files that define or import a std-named macro, or import `similar_asserts::assert_eq` (seed 5113, of 61) | 25 | 25 |
| **Total (115 distinct: one Vector link drawn twice)** | **116** | **116** |

That is 70 argument calls, 25 of them from the std-named-macro files.

The std-named files include `use std::{…, vec}` (dnstap parser),
`use similar_asserts::assert_eq` (the opentelemetry legacy tests,
`checkpointer.rs`), and `flate2::write::…` or `…::format::…` path segments
that bind nothing of that name. Every sampled call there sits in a macro
that is std's own at that site (`vec!`, std `assert!`/`assert_eq!` in files
without the `similar_asserts` import). Earlier rounds' samples (rounds 1–3:
90, 105 and 60 links, all right) are kept in `sample-review.md`.

Faults found and fixed across rounds:

- **Round 1, before review.** A module-level macro switched on the
  conservative binding facts for its whole file.
- **Round 1 review.** A nested item-defining macro; a definition-site local;
  `#[cfg]` in a body; a macro factory; a generated `mod`; a false statement
  about derives.
- **Round 2 review.** A `use … as println` in an expansion; a project
  `println!`; a repetition lost through nesting; a macro in a block inside
  format arguments.
- **Round 3 decision.** The workspace-wide name rule was too blunt. Round 4
  replaced it with the per-site rule above.

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

Round 4 adds `evidence/r1-k/controls4/` (rustc output in `output.txt` and
`glob/output.txt`):

| Program | rustc prints | Pymtheg |
|---|---|---|
| c1: project `writeln!` in scope only where the macro is defined | `[x]` (std's) | body call definite |
| c2: project `writeln!` in scope where the macro is invoked | `[]` (project's) | not definite |
| c3: `$crate::inner!` | `ROOT` | defining crate's root |
| n1: project `write!` in textual scope at the site | `end []` | not definite |
| n2: project `write!` in a sibling module, not in scope (ripgrep's shape) | `[1]` | definite |
| n3: `use … as println`; `use crate::println` | `end`; `end` | not definite |
| n4: `#[macro_use]` on a parent module | `end` | not definite |
| n5: `#[macro_use] extern crate` of a workspace crate exporting `println` | `end` | not definite |
| n6: defined later in the file | `1` | definite |
| n7: defined earlier in the same function / in another function | `end` / `1` | not definite / definite |
| n8: `use` of a workspace fn and module, `use std::vec`, `use std::panic` | `[1] [1] 1` | definite |
| g1–g10: globs bringing in std-named macros | E0659 each (g3: crate-root item, g4: textual) | globs not consulted |
| outside the workspace: `#[macro_use] extern crate`, `use ext::write` | not compiled (no such crate here) | not definite (fail closed) |

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

Checks on the dev server after merging `origin/main` (379b6018): `npm run
build`, full `npm test` 2,917 pass / 0 fail, `npm run format:check` clean,
`node scripts/spdx-tags.mjs --check` clean; the new source files carry the
SPDX tag.

Round 2 adds 24 fixture tests covering every control in `controls2/` (the table
above), each with the expectation rustc gave and, for each review finding, a
positive twin that must still resolve (harmless nested macro, call-site
local, no `cfg`, forwarding through a closure or loop, duplicated
forwarding).

Round 3 adds 17 fixture tests covering every program above. Round 4 adds 15 for the name rule, covering each control above (both outcomes of n7, the glob statement and the external fail-closed cases).

Round 5 adds `evidence/r1-k/controls5/` (`#[macro_export(local_inner_macros)]`,
an exporting crate `m` and an app, rustc output in `output.txt`):

| Program | rustc prints | Pymtheg |
|---|---|---|
| l1: bare `inner!` in the exported macro; app has its own `inner!` calling `helper` | `END` (m's `inner!`) | body call not definite |
| l2: forwarded arguments into a bare `quiet!` | `END` | argument not definite |
| l3: a bare `println!` there is `$crate::println!` | `END` | argument not definite |
| l4 twin: the same macro without `local_inner_macros` | `HELPER END` | body call definite |

Round 5 adds 4 fixture tests, one per program. `node --test
test/graph-rust-r1k-macros.test.mjs` runs 90 tests: 30, 24, 17, 15 and 4
added in rounds 1 to 5.

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
  `lib/tracing-limit/src/lib.rs`) put `failed-file-unseen-declarations` in
  the reason of 85,203 unresolved workspace links on main (94,389 after); a grammar fix (W2-P/W2-V line of work)
  would recover most of them.
- **Opaque scopes in Vector.** Outside this chunk's macro work, Vector's
  remaining `opaque-item-may-shadow-name` comes from non-standard derives,
  `#[test]`/`#[tokio::test]`, attribute macros such as
  `#[configurable_component]`, and external statement macros. In particular,
  60 files import `similar_asserts::assert_eq`, an unaudited external macro.
  Auditing `similar_asserts`, `pretty_assertions`, and the macro export lists
  of `tracing`, `derivative` and `cfg_if` in the ecosystem catalogue is the
  cheap next step. (Round 1 quoted per-cause scope counts from a one-off
  trace; they are not in the committed evidence and are no longer stated.)
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
