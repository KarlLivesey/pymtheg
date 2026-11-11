# W2-C: Rust language module for the code graph

Round-five revision, module version 5. Current origin/main is merged normally.
Only the owned Rust source, tests/fixtures, evidence and this note change. The
module uses supplied snapshots and the installed Rust WASM grammar through the
shared Tree-sitter helper. It never reads project files, shells out, expands
macros or requires Rust/Cargo. Scratch compiler oracles are developer evidence,
not runtime or test dependencies. Existing graph databases must be rebuilt
with core schema 3; the evidence runs use a fresh store.

## Constructs and limits

| Construct | Result |
|---|---|
| Crates/files/modules, functions, structs, enums/variants, traits/default methods, scoped impls, aliases, const/static, macro_rules | Symbols and contains links; private items are ordinary linkable symbols; exact UTF-16 positions |
| Namespaces and constructors | Separate type/value/macro lookup; named-field structs/variants cannot capture value calls; inference `_` never binds a name |
| Modules | Inline and function-local barriers; name.rs/name/mod.rs and literal path attributes; children of path-loaded files are beside the file; unsafe recovered module headers cannot establish file membership |
| Cargo context | Workspace path dependencies, library names and dependency renames; lib/bin and automatic src/bin/examples/tests/benches/build.rs roots; no Cargo execution |
| Imports | Nested groups, renames, raw identifiers, self/super/crate/absolute paths, cross-crate and chained reexports; use sites share recursive import lookup |
| Globs | Follow captured chains with cycle protection and visibility checks; local items/explicit imports shadow globs; a glob edge's own target remains backlog |
| Free calls, type/pattern/value paths | Definite when intact captured bindings prove a target; complete cfg alternatives become candidates; unresolved names retained |
| Expression values | Unit structs/variants, Self variants and simple paths emit values links. Local/self/generic references remain unresolved rather than acquiring outer item targets. Named-field variant imports/patterns are independent of bare values |
| Pattern bindings | Structural shorthand/ref/mut/captured/tuple/slice/struct/or forms in parameters, closures, let/let-else, if/while-let, match and for; actual binding regions mask outer functions |
| Alias/type applicability | Expand captured aliases/chains/references; known Box/tuple/array outer shapes cannot become universal blankets for unrelated types; cyclic/external/unsupported substitutions stay unknown |
| Lifetimes and generics | Lifetimes do not select impls. Exactly distinct own parameters in Type<P1,...,Pn> prove fully generic applicability; bounds permit omitted-argument path family lookup, not unproven dot applicability. Explicit instantiated paths require applicability evidence; other specialised arguments need compatible captured evidence |
| Associated path calls | An intact applicable inherent member wins over trait alternatives. A sole family with omitted type arguments is selected before inference; explicit instantiated paths cannot bypass unproved specialisation or bounds |
| Dot calls | The shared probe/completeness rule below applies to every source of unseen impls. First-step inherent matches remain definite; unknown later alternatives retain targets on an unresolved link |
| Custom receivers | Box/Rc/Pin syntax retained, without arbitrary Deref/projection/inference. Unknown custom receiver adjustment stays unresolved |
| Trait-only calls | One captured trait impl does not prove dispatch. Multiple targets form a closed set only when all applicability/completeness conditions hold |
| Macros | Local active macro_rules definitions/invocations linked; macro_export visibility pub. Opaque statement tokens invalidate affected binding evidence; literal type tokens in item macros feed the shared unseen-impl rule |
| Conditional code | Both branches captured; no feature/platform selection. Cfg twins may form complete candidate sets; arity accounts for conditional arguments/parameters |
| Syntax errors | Partial remains partial. Unsafe recovered symbols cannot prove links; file-level declaration loss independently marks module/crate uncertainty, even when no declaration survives |
| Std/external/generated declarations | Unresolved with names retained; no toolchain/filesystem fallback |

No macro token-tree bodies/generated declarations are extracted or expanded.
Cross-file macro exports/imports, mixed external/project globs, Copy receiver
refinement, generic substitution precision, custom receiver projection, inner/outer
macro ordering, where clauses in impl identity text, qualified `<T as Trait>::f`
and a glob edge's own target remain the manager-listed backlog. General
trait-in-scope, result/closure/chained-receiver inference, bounds solving and
associated-type projection are not implemented. Loose files retain symbols;
nested support files are not invented as automatic Cargo roots.

## One dot-dispatch rule

For a known receiver, Rust considers its actual type first, then shared and
mutable autoref steps, repeating through autoderef. At each probe inherent
methods precede trait methods. The module proves the nominal receiver forms it
captures; custom autoderef remains unsupported.

An intact, applicable inherent member at the **first probe** is definite despite
unseen traits: `T` with `fn f(self)`, `&T` with `fn f(&self)`, `&mut T` with
`fn f(&mut self)`, including syntactically exact self receivers. All cfg choices
must satisfy that proof before a closed set is emitted. This check precedes every
unseen-impl source below. It replaces the unconditional item-macro veto.

For later probes, and for trait paths without a proven inherent member, these
sources make the named dispatch incomplete:

- A type's derives/attributes may supply the name.
- Literal type-name tokens in opaque item macro invocations may add impls.
- Captured project blankets/reference impls, unknown trait defaults, or the
  std/core universal-name table may supply the name.
- The caller's crate or the receiver's owning crate has declaration-loss evidence.

Each source feeds the same completeness decision. Incomplete trait-method sets
are unresolved too. A proven inherent path member remains independent of
these dot-probing uncertainties. With omitted arguments a sole inherent family
wins name lookup before inference; with explicit arguments an unavailable
specialised or bounded impl can instead expose a trait member. Such explicit
paths require applicability evidence; unsupported substitution stays unresolved.
Scratch compiler controls distinguish these cases. Unsafe headers cannot
become proof through this precedence shortcut.

Known derives supply exactly these names:

| Derive | Possible method names |
|---|---|
| PartialEq | eq, ne |
| PartialOrd | partial_cmp, lt, le, gt, ge |
| Ord | cmp, max, min, clamp |
| Hash | hash |
| Clone | clone, clone_from |
| Debug | fmt |
| Default | default |
| Eq, Copy | none |

The same attribute index normalizes captured alias chains and references onto
the underlying nominal type. An attributed identity or unexpanded alias which
cannot be restricted to a captured nominal can supply an unrestricted impl;
known Box/tuple/array outer shapes do not taint unrelated nominal receivers.
First-probe and inherent-path precedence remain independent of these facts.

Unknown/custom/qualified derives and opaque attributes make every later-step
name uncertain. Comments between an attribute and item do not hide the attribute.
`cfg_attr` payloads are inspected conservatively without choosing a configuration.
The known-inert attribute list is exactly: `allow`, `warn`, `deny`, `forbid`,
`expect`, `cfg`, `cfg_attr`, `repr`, `doc`, `deprecated`, `must_use`,
`non_exhaustive`, `inline`, `cold`, `track_caller`, `no_mangle`, `export_name`,
`link_section`, `used`, `automatically_derived`, `test`, `ignore`, `should_panic`,
`path`, `macro_export`, `macro_use`, `link`, `no_std`, `no_implicit_prelude`.
Only cfg_attr payloads can introduce dispatch uncertainty from this list.

The std/core universal method-name table remains exactly: `from`, `into`,
`try_from`, `try_into`, `borrow`, `borrow_mut`, `to_owned`, `to_string`, `type_id`,
`as_ref`, `as_mut`, `clone`, `clone_from`, `into_iter`, `default`. Names outside
this table are assumed not universally supplied by uncaptured standard blankets.
Known derives are a separate per-type source, not additions to that global table.

Opaque macros are guarded only by literal invocation tokens and statement/item
positions. They can invent names absent from those tokens; no expansion attempts
to discover them. Statement macros can invalidate receiver evidence before the
probe rule is reached. The keywords `self`/`Self` cannot be rebound: their
signature type is retained and their semantic impl type feeds the same macro
effect index, so exact first probes resolve while later probes stay uncertain.
New ordinary bindings can establish fresh evidence afterward.

## One declaration-loss rule

Parsing records `data.declarationLossy` independently of surviving symbols. A
top-level ERROR, an ERROR/missing syntax in an item header (including preceding
attributes, use/extern items and macro definitions, even inside a closed function), or an unclosed body
that might swallow declarations sets it. Closed function/closure expression-body
errors alone do not imply lost surrounding declarations. This is tree structure,
not a search of recovered text for impl/type spellings.

There are two consequences:

1. At crate level unseen impls may exist. Later-step dot dispatch and trait-method
   sets are incomplete throughout that crate, including clean callers and callers
   using its types from other crates. First-step seen inherent members and seen
   inherent path members remain usable.
2. At module level unseen items may shadow glob, prelude or enclosing fallbacks.
   Such lookup is incomplete, including across reexport chains. Intact local
   declarations and explicit uses remain authoritative; a duplicate would not
   compile. A partial module's intact declaration can still be reached through
   a glob. Partial status alone is not a blanket namespace rejection.

Unsafe/recovered/swallowed declarations can retain evidence but cannot establish
proof or closed sets. Invalid headers make their surviving descendants unsafe;
missing closing body braces taint swallowed structure. Lost headers which emit
no symbol still trigger the file/crate rule. Recovered module declarations do not
establish another file's membership. This replaces the earlier statement that
simply excluding unsafe impls from an index suffices.

## Identity, interface and resolution work

IDs combine project/module/file, kind, scoped identity and duplicate ordinal;
positions are excluded. Impl identities preserve self/trait/generic syntax;
where clauses remain omitted and ordinals distinguish equal text. Method
ownership uses contains source IDs. Raw identifier spelling normalizes while
spans retain the source spelling. Structural block ordinals avoid positional IDs.
The strict independent blank-line identity conformance test has no exclusions.

All emitted candidate sets are **closed**. Incomplete choices use
**unresolved-with-targets**: `data.targets` retains known project evidence and
`data.uncertainty` states why it is incomplete. No `open` marker is emitted. This
metadata is not an exhaustive one-of relation. Simultaneous import namespaces
also cannot be asserted as one-of and remain unresolved. No core/interface change
was made. Analyze uses one resolver pass to attach evidence; core resolve then
runs normally, without reparsing or disk reads.

Imports, places, declarations, members and per-function binding evidence are
indexed once. Completed module-view lookups and reachability/dispatch guards are
cached. Receiver filtering copies memoized results before applying uncertainty.
Work depends on path depth, candidate memberships and reexport/dependency
relationships; timings are observations, not assertions.

## Round-five evidence

| Observation | Fourth-review head `3f1c81f9` | Current release |
|---|---:|---:|
| Claimed / clean / partial / failed | 1,563 / 1,552 / 11 / 0 | 1,563 / 1,552 / 11 / 0 |
| Symbols | 35,907 | 35,907 |
| Links | 365,699 | 365,699 |
| Resolved | 115,794 | 116,400 |
| Closed candidate sets | 1,102 | 1,102 |
| Unresolved | 248,803 | 248,197 |

All Rust sources at Vector `515e87d9861b564f521a8992d224892cd8cae120` were freshly indexed through
the real indexer and schema-3 store, with zero analysis/resolution errors. All
365,699 derived links match the independent direct-module output, including
target IDs and uncertainty data. Symbols/links by kind and top unresolved names
are in `round5-release-store.json`. The 92 Cargo roots remain 36 lib, 11 bin,
3 example, 18 test, 14 bench and 10 build.

Observed store wall time: 348.327 s; module parse
133.791 s, analysis 12.778 s, resolve
13.777 s. Direct module wall time: 195.714 s
(parse 115.193 s, analysis 26.996 s,
resolve 26.435 s). Different loaded-machine runs are
observations, not speed assertions. Sources/stores stay in disposable scratch.

The exhaustive comparison restores **864 definite dot
calls at the first probe** and **72 inherent path calls**,
936 calls total. A scratch-only trace verifies the actual proof
branch and reproduces every production decision. Of the dot restorations,
811 were blocked by the old item-macro veto.
No definite link retargets. Every closed candidate set has the same key and
project targets as the reviewed head; the temporarily introduced FromIterator
path set was caught in development and is unresolved in release.

330 old definite links become uncertain (281 calls,
43 imports, 6 types). Among the calls, **50**
carry derive/attribute uncertainty: 29 solely
that new reason, 21 also declaration loss.
Another 3 explicit/generic path calls also carry
attribute uncertainty after applicability was left unproved; these are separate
from the dot-probe count. These overlapping reason counts are not additive. Fifteen seeded withdrawals
were inspected: every one is a later probe on a genuinely attributed type;
source declarations and receiver forms are recorded in
`round5-dispatch-hand-check.json`.

**895 dot calls** still have the
item-macro reason, versus the old 1,588: 777 from that old
cohort remain and 118 newly carry the reason
(86 formerly definite and
32 already unresolved). Keeping
self/Self signature evidence also retains their semantic type in the macro
effect index; this prevents newly exposed later-probe guesses. The common completeness check also records
that reason on 2,657 already/incompletely
resolved trait paths without a seen inherent member; all calls with the reason
number 3,552. This is metadata coverage, not
3,552 newly lost links. Limits around literal
tokens, generated declarations, custom receivers and generic applicability remain.

The structural rule marks these files declaration-lossy in the unchanged
Vector snapshot: `lib/codecs/tests/avro.rs`, `lib/tracing-limit/src/lib.rs`, `src/config/builder.rs`, `src/config/compiler.rs`. The other grammar partials do not by themselves imply lost surrounding
items under this structural test.

In the full captured snapshot, perturb `lib/vector-core/src/event/log_event.rs`
in memory and reanalyze/resolve the module. The checkout is not edited:

| Edit | Changed file: definite links lost | Rest of vector-core library | Other Cargo targets/crates |
|---|---:|---:|---:|
| truncate after opening field-list brace | 332 | 143 | 482 |
| insert < into impl header, retaining the rest of the file | 62 | 39 | 193 |

The struct truncation removes 321 old source relationships;
11 retained file links lose definiteness. The impl edit
retains the rest of the source and maps positions across the two inserted characters;
60 retained file links lose definiteness and
2 old header relationships disappear in recovery.
Counts include references to removed/unsafe declarations as well as the global
uncertainty rule. They are not counts of wrong old links. Exact grouping and
retained-versus-removed counts are in `round5-release-lossy-experiment.json`.

All original **152** are re-derived against round-one `d60ac141` on the same
131 files. **94 are restored; 58 remain unresolved**.
Remaining classification: (a) wrong before **0**, (b) unprovable under a named
current rule **58**, (c) correct/provable still lost **0**.

The earlier c=0 claim for the 51 was inaccurate. This revision restores
**7 of those 51**, including original #64,
#65, #67 and #68, RegisteredEventCache::new and MaybeTlsIncomingStream::new.
At the same time **14 previously restored
entries** gain required attribute uncertainty (LogSchema getters and proto-origin
metadata getters). Hence the restored total can fall despite fixing these
provable losses. No old target is called wrong without evidence.
`round5-release-loss-classification.{json,md}` enumerates every original edge,
its old targets and its rule; `round5-classification-movement.json` makes the
cohort movements explicit. Another 12 newly
withheld edges in those two crates are listed separately.

Fresh seed 0x20261115: 30 resolved, every endpoint in 15 closed sets, 15 general
unresolved and 20 in-project-target unresolved self calls. Source contexts and
all endpoints were inspected. No sampled wrong definite or incomplete closed
set was found. The targeted sample leaves only later-probe uncertainty or the
explicit generated-type/module-membership/custom-receiver/cross-impl-bound limits;
no further ordinary supported pattern was left merely as a finding. Additional
15 attribute withdrawals and 15 first-probe restorations were hand checked.
Sampling is not a universal accuracy proof. `round5-audit.md` and hand-check JSON
retain individual judgments.

## Validation and history

The required isolated sequence passed: `npm ci --ignore-scripts`;
`npm test` with the requested `PYM_TLC_JAR` (**1,357 passed**);
`npm run format:check`; then `node --test test/graph-rust*.test.mjs`
(**111 passed**). Zero failures, cancellations or skips.
Source hashes were unchanged through the sequence. All **52**
scratch compiler oracles pass. All three required mutations fail assertions
against a passing baseline. Exact-position and independent blank-line identity
conformance remain enforced without exclusions. `round5-validation.json` and
`round5-README.md` identify final evidence; all earlier attempts are history.

Scratch-only compiled-module mutations turn off derive-name uncertainty, widen
the first-step shortcut to later probes, and disable file lossiness. The baseline
must pass and every mutation must fail an assertion. Scratch rustc oracles include
an independent tiny proc-macro crate; no compiler is imported by tests/runtime.
Earlier evidence and failed/development attempts are preserved and identified as
superseded. Round-four's assertion that no correct/provable link remained among
the 51 was inaccurate; the new classification is re-derived, not relabelled.

A final normal refresh of origin/main changed only the manager build-plan ledger.
The implementation/test hashes still match the completed required check sequence;
no runtime/core change was introduced by that refresh.
