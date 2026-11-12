# W2-C: Rust language module for the code graph

This is the **no-toolchain fallback** under D16. Precise compiler-backed Rust
resolution belongs to a later chunk. Version 12 uses the installed Rust WASM
grammar through the shared Tree-sitter helper and supplied source/manifest
snapshots only. Runtime, installation and tests never invoke Cargo/rustc, read
project files, expand macros or add dependencies. Private items are ordinary
linkable symbols. Old databases need rebuilding with schema 3.

**A file that cannot be read is not valid code; it has failed; nothing in it is
a target.** Any Tree-sitter ERROR or MISSING node, anywhere, makes the entire
file `failed`, with no symbols or links. There is no `partial` result, recovered
item, unsafe header, confinement exception or invalid-symbol salvage.

**Grammar limitation:** all 11 files rejected in the pinned Vector revision are
accepted by the native Rust syntax parser. These real, syntax-valid files now
fail indexing under the owner's rule. There is no special case for them. The
syntax-only oracle is not a claim to have typechecked all of Vector.

## Constructs

| Construct | Fallback result |
|---|---|
| Crate/module/file units; functions, structs, enums and variants, traits/default methods, scoped impls, aliases, const/static, macro_rules | Symbols with positions, visibility and contains links; failed files contribute none |
| Type/value/macro namespaces | Separate lookup. Named-field structs do not capture value calls; unit/tuple constructors do. `_` never binds a name |
| Modules | Inline and function-local barriers; name.rs/name/mod.rs; literal path attributes including raw strings. Path-loaded files' children are beside the file. Doc strings never become path attributes; absolute paths have no captured root proof and stay unverified |
| Cargo context | Captured/default/inherited/per-target editions, conditioned normal/dev/build/optional dependency edges, dependency renames, workspace path dependencies; explicit and automatic lib/bin/src/bin/examples/tests/benches/build.rs roots. Loose files retain structure without invented crate membership |
| Imports | Nested groups, renames, self/super/crate/absolute/raw paths; chained and cross-crate reexports; anonymous imports do not bind `_` |
| Globs | Recursive captured reexports with cycle protection and importer visibility; intact local/explicit bindings beat globs only in their proved namespaces; unknown external import namespaces retain glob hints. A glob edge's own target remains backlog |
| Free calls, type/pattern/value paths | Definite from proved, present-as-written bindings; complete captured alternatives become candidates. Unknown alternatives remain unverified. Missing names stay unresolved with names retained |
| Values | Unit structs/variants and Self/path expressions extracted. Struct/named-variant literal names are constructor-capable type references. Locals/generics never acquire outer item targets |
| Pattern bindings | Structural shorthand/ref/mut/captured/tuple/slice/struct/or patterns across parameters, closures, let/else, if/while-let, match and for; binding regions mask outer functions |
| Alias/type applicability | Captured alias chains and generic/reference aliases expanded. Unsupported/cyclic/external substitutions remain unknown; unknown never means disjoint |
| Lifetimes/generics | Lifetimes ignored for impl selection. Distinct own parameters in Type<P1,...,Pn> describe a fully generic family. Explicit instantiations, specialisation and bounds still require applicability evidence |
| Associated path calls | A proved inherent name wins over traits. A sole family with omitted arguments can support name lookup before inference; explicit generic arguments cannot use that shortcut. Unknown alternative inherent impls block proof |
| Dot calls | Definite ONLY a unique proved, present-as-written inherent first-probe match. Everything else is unresolved-with-targets, with no closed dot-call candidate sets |
| Trait-only associated calls | Unresolved-with-targets: captured bodies/defaults are would-be targets, not proof of dispatch |
| Conditional code | One collector combines outer/inner cfg/cfg_attr, enclosing items, crate/module-file conditions and parent mod declarations. Statement/expression/binding/field/variant/arm/parameter gates are retained. Caller implication is same-crate only; no feature selection. Unknown predicates never prove a link. Complete namespace/path alternatives may be candidates; dot twins remain unverified |
| Macros/attributes | Local active macro_rules invocations link; macro_export records public visibility. Token trees are not expanded/extracted. Statement tokens and opaque block item generation can invalidate binding evidence; opaque item generation can shadow namespace fallback |
| Std/external/generated declarations | Unresolved; no compiler or filesystem fallback |

Associated const/projection lookup, qualified `<T as Trait>::f`, custom receiver
adjustment, general autoderef/unsizing, substitution/inference/bounds solving,
trait-in-scope precision and generated declarations are not implemented.
Direct optional-dependency activation (`feature="dep"` or a direct `dep:dep` entry) is captured. General Cargo feature closure and actual platform/build configuration are not evaluated: dependency proof uses captured predicates, not a feature solver.
General cross-file macro_rules resolution, external glob beside project glob, Copy receiver
refinement, inner/outer macro ordering, where clauses in impl identity text and a
glob import's own link remain the manager-listed backlog.

**Known limit E4:** unknown exports of a **bare** `#[macro_use] extern crate`, or opaque generated output, are assumed not to bind the attribute heads `derive` or `global_allocator`. A native accepted macro-use counterexample violates that assumption and can produce a definite written target different from rustc. It is explicitly asserted in the known-limit tests in `test/graph-rust-round12.test.mjs`, documented below, and reserved for D17 to resolve. Captured visible bindings still shadow these heads; `test`, `bench` and tools stay strict.

## Dispatch and unverified target representation

For `recv.name(...)`, the only definite result is an **inherent** method at the
first probe of the captured receiver: owned T with self, &T with &self, or &mut T
with &mut self. The inherent method must be visible from the caller module; private, pub(crate), pub(super) and pub(in path) restrictions are checked. Receiver lifetime/mutability forms are parsed structurally. Every
inherent alternative at that step must be proved applicable or inapplicable; the receiver type and selected method must also be present-as-written (see the opaque-attribute rule below).
Unknown bounds, cfg conditions, unresolved inherent self types, ambiguous module
views and unknown receiver adjustments prevent proof. First-step proofs survive
unseen trait impls and failed dependencies.

Every other dot call is `unresolved`. Up to 16 valid project hint IDs are stored
in `data.targets`; larger lists are omitted, with `data.targetCount` and a
`too-many-targets` uncertainty reason. A count-only overflow is never a truncated
list. Single-target hints are unchanged. Explanations in `data.uncertainty` include
`later-probe-step`, `trait-dispatch`, `inherent-applicability-unverified` or
`receiver-type-unverified`. These are **would-be targets, unverified**, even if
there is exactly one. No dot call emits a closed candidate set. The hint inventory collects valid project instance bodies/defaults by name,
including autoderef destinations and impls with unknown ownership; overflow
stores only its count.
This deliberately broad name-based superset does not simulate trait dispatch or
claim the receiver can call every listed body. Unresolved impl self/trait lookup retains its valid method
bodies as possible targets; failed files supply no bodies at all.

There is no derive-method table, std blanket-name table, trait-scope catalogue or
macro/attribute unseen-impl proof in dispatch. Their sole later-step precision
purpose was removed. Retired experimental table evidence is historical only.

## Item presence and structural containment

`contains` remains definite: it describes the captured source AST, including cfg-gated or opaque-attributed items. It is **not** a claim that an item survives macro expansion. Every affected symbol is marked `data.underOpaqueAttribute: true`, with the full inherited attribute paths in `data.opaqueAttributes`. This includes attributes inherited through a file-module declaration or crate inner attribute. Re-analysis clears old markings when the attribute is removed, even when the child file's parse result is cached.

For **semantic** links (calls, imports, implements, module/path/type/struct/variant/const/macro references), one shared presence predicate requires the item and every enclosing item to be free of non-builtin attributes. Unknown attributes may replace or remove their input. Such input stays a would-be target, never a definite target or closed set; `item-under-opaque-attribute` explains the uncertainty and `data.opaqueAttributes` identifies the relevant paths. A first-probe match does not bypass this rule. Derive preserves its input item; its expansion remains unseen.

Attribute classification is centralized in `parse.ts:attributeRules`; the same classification drives presence, implicit gates and semantic namespace. The native explicit-import shadow probes in `round11-attribute-oracles.json` pin every true-builtin entry against rustc (49 reject replacement with E0659; cfg/cfg_attr reject it as a reserved attribute name).

| Class | Paths | Presence/meaning |
|---|---|---|
| True builtin, inert | allow, automatically_derived, cold, collapse_debuginfo, coverage, crate_name, crate_type, debugger_visualizer, deny, deprecated, doc, expect, export_name, feature, forbid, ignore, inline, instruction_set, link, link_name, link_ordinal, link_section, macro_export, macro_use, must_use, naked, no_builtins, no_core, no_implicit_prelude, no_link, no_main, no_mangle, no_std, non_exhaustive, optimize, panic_handler, path, recursion_limit, repr, should_panic, target_feature, track_caller, type_length_limit, used, warn, windows_subsystem | Cannot be replaced by a same-named attribute import; input exists as written, subject to enclosing gates/opacity |
| True builtin, conditional | cfg, cfg_attr | Existing predicate implication and conditional payload rules |
| True builtin, macro declaration | proc_macro, proc_macro_attribute, proc_macro_derive | Retain AST function identity for stable structural IDs; export in macro namespace (derive's exported name), not an ordinary external value function. Source function remains callable within its own crate. Conditional macro kind is unverified |
| Prelude attribute macro, conditional | test, bench | When unshadowed, function presence implies cfg(test); other syntactic targets stay unverified |
| Prelude attribute macro, inert (E4) | derive, global_allocator | Only a **visible source binding** shadows these heads. Unseen output is assumed not to bind them; otherwise preserve input |
| Prelude attribute macro, unmodeled | test_case, cfg_eval, cfg_accessible | Opaque even without a shadow; no unsupported compiler transformation is proved |
| Registered tool prefix | rustfmt, clippy, diagnostic, miri, rust_analyzer | Qualified paths only; inert only when unshadowed |
| Other | All other paths, including bare imported names | Opaque |

`test`/`bench` and tool prefixes keep strict shadow classification: explicit/local bindings, potentially binding macro-use exports or item generation can make them opaque. Captured dependency names can shadow tool prefixes via the modern extern prelude. Glob `use` is not itself an attribute shadow (E0659 ambiguity).

**E4 exception:** `derive` and `global_allocator` are shadowed only by a binding visible in captured source: an explicit non-glob import or local item/macro of that name in an enclosing scope, including named exports read from a captured macro-use crate. A named `#[macro_use(name)]` list is itself a visible binding, even when the exporting crate is uncaptured (rustc requires that export). Only a **bare** uncaptured `#[macro_use] extern crate`, item-position macro output, or opaque attribute output is **assumed not to bind either head**. This is an owner-selected assumption of the structure-level fallback, not proof that unseen code cannot replace them. Explicit captured bindings still prevent semantic proof. Scope provenance excludes a function's own body imports from its attribute's scope and a module body's bindings from its containing module attribute.

Unsafe wrappers recurse. `cfg_attr` payloads apply only when their predicate can hold alongside the item's gates; impossible payloads add no opacity. Nested payload paths retain their full spelling, e.g. `pm::keep`. Attribute contexts are interned per file, rather than duplicated on every semantic link. Re-analysis recomputes contextual gates and opacity even for cached child parse facts.

References: [Rust attributes](https://doc.rust-lang.org/reference/attributes.html), [testing attributes](https://doc.rust-lang.org/reference/attributes/testing.html), [tool attributes](https://doc.rust-lang.org/reference/attributes.html#tool-attributes), [procedural macros](https://doc.rust-lang.org/reference/procedural-macros.html), and [macro-use prelude](https://doc.rust-lang.org/reference/names/preludes.html#macro_use-prelude).

## Cargo editions and conditioned bindings

Captured manifests are read by a structural, snapshot-only TOML parser: bare/quoted/escaped/dotted keys; inline/standard tables and arrays of tables; comments, basic/literal/multiline strings and escapes. No Cargo-specific key regexes remain. Unsupported/invalid TOML rejects the **whole document**, never recovers a partial edition or defaults unread text to 2015. Datetime values are deliberately unsupported: even in unused metadata, they make the document unknown. Missing edition defaults to 2015 only in an understood document. A document with no readable package/name supplies no crate ownership, so semantic paths depending on it cannot be definite. Ill-typed editions remain unknown; ill-typed target identities do not trigger guessed automatic targets. Unsupported membership glob syntax makes workspace inheritance unknown. Target discovery, dependency renames/kinds/optional activation, workspace members/exclude and inherited package/dependency facts consume the same normalized keys. Patch/replace paths are retained as possible alternatives, with `?manifest-override`: Cargo's version/registry selection is not proved. Unreadable manifest/override reach never invents an invalid-code cause. Direct `dep:` activation suppresses Cargo's implicit alias feature; arbitrary feature closure remains unmodeled.

Literal editions 2015/2018/2021/2024, missing-edition default 2015, package workspace inheritance, and per-target overrides are captured. The same edition-aware import lookup serves import links and forwarded names/reexports. In 2015, unqualified use and absolute paths start at the crate root; ordinary expression paths remain lexical. In modern editions, uniform imports and the extern prelude apply. Explicit extern-crate aliases are captured. Unknown edition compares both interpretations and withholds certainty when they differ.

Every dependency route retains target cfg, optional-feature activation and dependency kind. Dev edges require a test/example/bench target or an implied test predicate; build edges belong only to build scripts. Unproved edge presence keeps captured bodies as hints and cannot accuse a failed file. Multiple captured routes are retained; they are not flattened into an unconditional winner. Failed-file reach annotations use only provably present captured edges, never an unproved conditional edge.

Without a complete prelude catalogue, sysroot names std/core/alloc/proc_macro/test, drop, and conservatively every capitalized dependency name cannot prove an implicit external binding. An unconditional explicit `extern crate ... as ...` can prove a non-sysroot crate binding, including a prelude-name collision: the explicit declaration names that crate in the type namespace. Sysroot collisions remain conservative even then. No std method table is reintroduced. References: [paths and editions](https://doc.rust-lang.org/reference/paths.html), [extern prelude](https://doc.rust-lang.org/reference/names/preludes.html#extern-prelude), [extern crate](https://doc.rust-lang.org/reference/items/extern-crates.html), [Cargo dependency kinds](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html).

## Failed files, causes and namespace uncertainty

The first grammar error by position yields one diagnostic with its source range
and 1-based line/column. MISSING says ``missing `token` ``; ERROR says
``unexpected `first-token` `` (one line, at most 40 token characters). Tree-sitter
does not supply expected tokens at ERROR nodes; none are invented. Diagnostic
text is deterministic and contains no absolute path.

A valid-file non-dot link is `unresolved` with `data.uncertainty: "invalid-code"`
only in two cases: a path names a module whose own file failed, or an explicit
non-glob use names an item in such a module (including names bound by that use).
A glob whose source module failed has UNKNOWN exports: falling through to it
never establishes invalid-code. Such names stay unresolved with
`failed-file-unseen-declarations`, without a cause, including prelude and macro
names. Captured paths/explicit reexports in a valid module retain their own
named failed-file dependency evidence. `data.cause.files` names those
project-relative files, sorted. It has **no target, candidates or data.targets**.
A missing name or an associated call with no captured targets is not evidence of
an item in a failed file: it remains unresolved, without a cause. Fixing and
re-indexing clears causes and resolves newly readable declarations.

A failed file also means unseen declarations may exist. Its owning module's
fallback lookup through a glob or an enclosing scope cannot prove an unshadowed
name; intact direct declarations and explicit imports in valid files remain
authoritative. Dependency reach is proved only by captured manifest edges.
Workspace dependencies use the root workspace manifest; workspace package
inheritance does not make the graph unknown, and registry dependencies do not
create project edges. Ambiguous/missing edges never justify accusing unrelated
failed files. `failed-file-unseen-declarations` is attached only for provable
reach. Dot calls never become invalid-code and this annotation cannot undo a
proved first-step inherent match. Internal parser exceptions are reported as
parser errors by the indexer, with their own diagnostic; they are not syntax
failures and cannot create an invalid-code cause.

Captured cfg predicates are compared structurally with bounded propositional
implication (all/any/not; string contents preserved). A condition gating the
caller in the same crate is satisfied whenever that call compiles: all(a,b) implies a, while a
does not imply b or not(a). Conditions from another crate are not assumed: equal feature names in two crates do not establish equal feature selections. Other alternatives remain unknown. Conditional local
items and explicit imports form one binding family so import alternatives do
not disappear from closed sets or unverified hints. An opaque lexical binding likewise cannot erase a captured dependency route: its known project bodies remain hints, with no proof upgrade or guessed failure cause. No feature selection runs.
Let-chain bindings activate after their initializer, covering subsequent
conditions and the body; arm patterns exclude guard expressions, whose own
let-bindings activate separately. Let-else binds after the statement, never in
its else block. Closures, labelled blocks, loops and nested/or patterns retain
their lexical boundaries.

The grammar, parser and query are lazily loaded **once per process**. Calls are
synchronous after loading, with invocation-local source state reset in finally;
the shared helper deletes every tree after extraction. Only JSON facts escape.
The query/parser remain alive for reuse, rather than repeatedly allocating WASM
grammar instances that disposal cannot free.

Opaque item-position macros and non-builtin attributes in lexical item containers
(module/file/function/block scopes) similarly make glob/outer
namespace fallback uncertain. Direct intact local names and explicit imports
still win. Hoisted block value items/imports cannot leave a shadowed parameter
receiver type in the binding cache; named-field structs remain type-only. A block
macro/attribute that could create a value item conservatively removes parameter
type proof (never the special self receiver). Field/variant helper attributes cannot introduce lexical item bindings. Generated
associated items in impl/trait bodies do not shadow bare module names. This one
container rule also excludes expression-only macro positions. The guard does
not expand macros or establish a dispatch result.
`cfg_attr` payloads are inspected; conditional module paths retain every captured
layout and mark missing alternatives unknown. Standard derive *spellings* only
help this namespace annotation when unshadowed by named/glob imports or
effective macro_use routes (including nested cfg_attr payloads whose predicates are not provably false); no per-method derive knowledge
remains. The current shared classification is `parse.ts:attributeRules`, with
conditional test/bench behavior and E4 visible-binding exceptions as stated
above; unknown attributes remain opaque. This namespace annotation does not
turn later-step method dispatch into a definite link.

## Identity, performance and interface

Identities use lexical module/function/type/trait/impl scope and position-free
textual impl identities. Inherent A::new and B::new differ; trait-for-type impls
differ from inherent impls; repeated headers get stable ordinals. Positions do
not enter IDs. Blank-line conformance and incremental-store tests cover this.

Imports, places, ownership, members, reachability and function binding analysis
are indexed/cached per analysis. Analysis writes metadata through the frozen
interface; resolve writes definite/closed decisions only. No core files change.
The interface has no separate failed-link enum, so failed links use unresolved
plus invalid-code/cause metadata. They are distinguishable from valid but
unverified dot calls. Syntax diagnostics use the interface's message/range. A thrown per-file parser exception is recorded by the frozen indexer in `report.errors`; it is not converted to a source-syntax diagnostic or an invalid-code cause.

## Review-response audit and validation

The round-five F1/F2/F3/F4 and exact Sol custom Clone/impl-attribute repros are
safety tests: no later-probe definite link, inherent body retained as unverified.
F5 retains valid unresolved impl bodies and failed dependency reach. F6 is
superseded by whole-file failure. F7 retains bounded/cfg alternatives instead of
closing from a proven subset. Error-region recovery, unsafe-item tests and
confinement mutations were retired rather than weakening whole-file failure.
The detailed filter-site audit is d16-alternative-audit.md. Signature lookup stays outside body-local item scopes; opaque fallback retains known outer targets as unverified. Each impl view carries its own cfg conditions rather than overwriting a shared symbol's conditions.

Compiler oracles, scratch mutations, full real-indexer/store comparison,
link-by-link movement, samples, original-152 classification and sequential check
results are recorded in evidence/w2-c/d16-*. Runtime/tests do not invoke these
developer compiler scripts. Compared with 6392ab71, the runtime diff removes 913 lines and adds 1,129
(net +216). Recovery/confinement and later-probe dispatch proof code is gone;
new lines implement structural binding/namespace evidence, failure accounting,
diagnostics and bounded hints.

Pinned Vector: `515e87d9861b564f521a8992d224892cd8cae120`; comparison head: `6392ab7183b4df167abef330470fd0c45d6333bb`. Every repository `.rs` file was indexed through the real indexer and a fresh schema-3 store. No core edit, output truncation or raised Node heap in the final run.

| Metric | 6392ab71 | Final |
|---|---:|---:|
| Claimed files | 1,563 | 1,563 |
| Clean / partial / failed | 1,552 / 11 / 0 | 1,552 / 0 / 11 |
| Symbols | 35,907 | 35,422 |
| Links | 365,699 | 365,514 |
| Definite | 116,400 | 72,565 |
| Closed candidate sets | 1,102 | 79 |
| Unresolved | 248,197 | 292,870 |

At shared positions: **0 gains / 45,191 withdrawals / 0 retargets**. Failed source files remove 6,726 links (1,394 formerly definite, 3 candidates); 6,541 added constructor/type references include 2,750 definite links. All counts reconcile with the final totals.

Of 1,435 definite dot downgrades: 69 are identified later-probe inherent matches, 0 trait definite links, and 1,366 receiver/applicability/namespace-unknown cases. 593 retain one would-be target. All 1,425 prior targets still valid under whole-file failure are retained or explicitly omitted by overflow; 10 prior targets are in failed files and cannot be hints. There are no closed dot-call sets.

Of the former 1,102 candidate sets: 79 remain closed, 1,020 become unresolved, and 3 disappear with failed source files. The one former dot-call candidate set becomes unresolved. Other withdrawals apply conditional-presence, opaque namespace and unknown-applicability rules; they are not newly discovered wrong callees.

| Withdrawal rule (exclusive priority grouping) | Links |
|---|---:|
| opaque item namespace | 37,865 |
| receiver unknown | 4,791 |
| inherent applicability unknown | 1,934 |
| conditional presence | 269 |
| later probe | 69 |
| invalid-code | 195 |
| other namespace/alias | 68 |

## Serialized output and overflow

Sizes are exact UTF-8 `JSON.stringify` lengths accumulated per item, never by constructing a monolithic graph string. `analysisReturnBytes` measures the module’s returned file analyses; graph-fact IR measures `fileFacts` symbols and links before storage/resolution. The three JSON profiles contain bytes by link kind, by top-level field and by nested data field, plus complete target-length histograms. Snapshot-only human-readable target descriptions are excluded.

| Serialized bytes | 6392ab71 | Uncapped draft | Final cap 16 |
|---|---:|---:|---:|
| Module analysis return | 128,057,684 | 627,531,284 | 152,209,680 |
| Graph link facts | 236,343,893 | 738,534,241 | 263,212,637 |
| Symbols + link facts | 254,077,796 | 756,472,304 | 281,150,700 |
| `data.targets` fields | 1,436,451 | 492,676,522 | 16,295,423 |

The uncapped growth was module output: target fields grew from 1,436,451 to 492,676,522 bytes. Calls accounted for 6,507,700 of 6,623,268 target references. Final `data.targets` stores IDs only. Lists over 16 are omitted entirely, with `data.targetCount` and a `too-many-targets` uncertainty marker. No prefix is emitted.

| Target-list distribution (all links; absent = 0) | 6392ab71 | Uncapped | Final |
|---|---:|---:|---:|
| median | 0 | 0 | 0 |
| p99 | 1 | 609 | 11 |
| max | 9 | 609 | 16 |
| sum | 10,110 | 6,623,268 | 190,254 |

Count-only overflow: **30,733 links** (29,970 calls, 762 types, 1 value). **65,365 nonempty lists** remain; 190,166 including existing empty lists. **40,885 one-target lists are unchanged**. Every short list and every resolution decision matches the uncapped run; no truncated lists exist.

Historical failures are preserved: the uncapped draft exhausted the default heap, then reached V8’s single-string limit in core `replaceAnalysis` at an 8 GiB heap. The bounded module completed through the same unmodified core at the default heap. These failed attempts are not presented as passes.

## Whole-file policy and grammar cost

**All 11 rejected files are accepted by the native Rust syntax parser (11/11). These are real grammar gaps, and they fail completely under the owner’s rule.** This is syntax acceptance, not a claim to have run Cargo/typechecked all of Vector. `src/config/builder.rs:89` and compiler.rs use cfg attributes on destructuring-pattern fields. Other gaps are a parameter pattern attribute, turbofish inference, a higher-ranked bound, and contextual `raw` reference/pattern forms. Per-file constructs, first diagnostics and native results are in `round6-grammar-audit.json`, `round6-grammar-note.md` and `d16-failed-files.json`.

Whole-file failure removes **485 symbols / 6,726 source links**. At 97040580 there were **267 targetless invalid-code links** with sorted failed-file causes. **104,099 links carried failed-file-unseen-declarations uncertainty**; 6,794 withdrawals carry that annotation, often alongside D16/type/applicability uncertainty. This is an annotation count, not a claim that file failure alone caused every one. The integrity audit checks all IDs, failure causes and absence of closed dot sets.

## Original 152 and fresh audit

At 97040580: **16 restored; 0 identified wrong-before; 136 unverified under the D16 fallback policy; 0 correct-and-provable under that policy still lost.** Of those 136, 123 retain the original hint and 13 have count-only overflow. Every row records its rule. Reviewer-highlighted #64, #65, #67 and #68 are restored. This is a changed D16 precision contract, not a claim that Rust itself cannot prove the 136 calls.

Fresh seeded source hand check: **30 definite / 30 newly downgraded / 15 unresolved**. No wrong definite link. Of the 30 downgraded calls, 26 retain the expected body and 4 omit the complete list by overflow; all four expected bodies are verified in the uncapped inventory. No unexpected missing hint. Individual judgments are in d16-samples.json.

## Observations and checks

Real indexer/store elapsed: 373.5 s; module parse 82.9 s, analysis 47.1 s, resolve 42.1 s. Node v24.21.0, execArgv `[]`, NODE_OPTIONS empty, default heap limit 4,496,293,888 bytes. Peak RSS 6,756,996 KiB. Timings/memory are observations on a loaded machine. All 365,514 links match direct module output including metadata.

Valid Cargo roots observed: 35 libraries, 11 binaries, 3 examples, 17 tests, 14 benches, 10 build scripts. src/bin, examples, tests, benches and build.rs are crate roots under Cargo target discovery, not forced loose files. Failed targets contribute no unit symbols.

At 97040580, sequential checks: npm ci --ignore-scripts; PYM_TLC_JAR=the supplied jar npm test (**1,389 pass, 0 skipped**); format:check; Rust tests (**143 pass**). All exit 0. **36 mutations killed**, including overflow; 71 native compiler cases plus the smaller namespace/binding/file controls pass. Runtime/tests never need rustc/Cargo.

Symbols by kind: `{"const": 1287, "enum": 704, "function": 9158, "impl": 4502, "macro": 59, "method": 9191, "module": 3659, "static": 144, "struct": 2747, "trait": 155, "type": 1197, "variant": 2619}`.

Links by kind: `{"calls": 134752, "contains": 33870, "implements": 2999, "imports": 28988, "macros": 24869, "modules": 1468, "patterns": 10937, "types": 73393, "values": 54238}`.

Top unresolved: `[["Some", 7810], ["assert_eq", 7414], ["String", 4464], ["None", 4407], ["Option", 4311], ["assert", 3904], ["Ok", 3815], ["Vec", 3118], ["vec", 2431], ["Result", 2209]]`.

## Round 6 review response (3dba60a8)

`origin/main` was merged normally (dcf83424), then refreshed by normal merge 7e46fde0 (upstream fe0d5b8c changes only the build-plan ledger; executable source/test hashes are unchanged). Runtime version is 7; no core, dependency or other-language edits. The module remains the D16 no-toolchain fallback.

- **B1:** every first-probe/path inherent proof checks accessibility from the caller module. Private/public restriction tests include descendant access, pub(crate), pub(super), pub(in path), enum paths through private modules and public reexports. Associated const/type projections already have no definite proof; fields remain out of scope. See round7-scope-audit.md.
- **B2:** let bindings activate in the rest of a condition chain and its body; match guard let-bindings are handled separately from arm patterns. The Reference scope audit and compiler controls cover initializers, guard/body boundaries, let-else, closures, labels, for and nested or-patterns. The signature-constant safety control is rejected by rustc, so it remains unverified rather than acquiring an outer function.
- **B3 / S1:** captured workspace inheritance does not make reach unknown. Workspace dependency definitions do not create unused package edges. Registry dependencies are distinguished from unknown project edges. Failed-file uncertainty uses only captured provable reach; a missing name/associated target never creates invalid-code. Causes require a traversed failed module, directly or through named imports. An uncertain dependency alternative cannot accuse a failed file.
- **B4:** bounded all/any/not implication respects caller conditions in the same crate, including inherited module and item conditions. Predicates are cached per run and canonicalised for cycle guards. Equal feature names in different crates are independent: native controls return `2 2` with dependency feature off and `1 1` with it on. No toolchain or feature evaluation runs in the module.
- **B5:** conditional declaration/import families retain both bodies. Opaque lexical lookup retains captured dependency alternatives and associated-method alternatives without upgrading uncertainty. The fresh audit found a lost SchemaGenerator hint; this shared fallback fix restores it. Identity/alias proc-attribute controls select dependency f (2) or project associated A::f (3), both retained as hints.
- **S2:** one lazily loaded parser/query/grammar per module process; each parse frees its borrowed tree through the shared helper and resets source state in finally. Internal exceptions throw a distinct parser diagnostic, enter the frozen indexer's report.errors, and never create a syntax invalid-code cause. Tests exercise 5,000 direct parses and two production-indexer passes over 2,500 files (2,499 force-reparsed in the second pass), all clean. Previous published Vector totals were not affected: every measured pass was a fresh process below the 1,996-load threshold, and 97040580 reproduces exactly here. Long-lived repeated indexing was unsafe and is now covered.

## Whole Vector through the real indexer/store

Fresh scratch clone, commit `515e87d9861b564f521a8992d224892cd8cae120`; every .rs, all 41 captured Cargo manifests, fresh schema-3 DB. Default heap: execArgv [], NODE_OPTIONS empty, heap limit 4,496,293,888 bytes. All 365,514 direct/store links match state, IDs and metadata exactly.

| Fact | 97040580 | New |
|---|---:|---:|
| Claimed / clean / partial / failed | 1,563 / 1,552 / 0 / 11 | 1,563 / 1,552 / 0 / 11 |
| Symbols | 35,422 | 35,422 |
| Links | 365,514 | 365,514 |
| Definite | 72,565 | 75,950 |
| Closed candidate sets | 79 | 88 |
| Unresolved | 292,870 | 289,476 |
| invalid-code | 267 | 247 |
| Failed-file uncertainty annotations | 104,099 | 175,075 |

Link-by-link: **3,385 gains / 0 withdrawals / 0 retargets**. 730 dot gains (583 self calls); 1,084 other call gains; 1,571 type/pattern/import/value/implements gains. The extra movement beyond the review's narrow patch comes from carrying item-level predicates and applying structural presence proof to namespace lookup too. Of the prior candidate sets, 77 remain closed and two become definite; 11 previously unresolved complete families become closed. No closed dot-call sets. All 11 new sets are recorded separately for review.

The 20 wrong causes are gone; all other 247 invalid-code links keep targetless sorted causes. Twenty fresh cause samples traverse the actual failed module/import path. The annotation count is not a failed-link or causal-dependency count: 27,426 old call annotations clear, 76,673 remain, and 98,402 previously plain unresolved names now carry reach-only context (imports/types/values/macros/calls/patterns/implements). The independent module/dependency audit validates provable reach for **every 175,075 annotation**. No unknown edge adds workspace-wide reach.

All 11 grammar-failed files are freshly accepted by native syntax parsing (round7-grammar.json): syntax acceptance, not a whole-crate Cargo/type check. The grammar still rejects real code, including cfg pattern-field attributes and contextual raw forms; none is special-cased. The old round6-grammar-note's graph-scope paragraph is superseded by this reach rule. Nothing in failed files contributes symbols/links or targets.

## Bounded unverified hints / output size

Representation stays **unresolved-with-targets**, no open closed-set marker. Hints are name-based project bodies, not verified dispatch, and may accompany an actual std/external callee. Up to 16 IDs only; overflow emits no list, only targetCount plus too-many-targets. First-step inherent proof is the only definite dot outcome.

Analysis return: 152,209,680 → 163,280,974 bytes. Graph facts: 281,150,700 → 292,221,994 bytes. 30,564 count-only links; 80,689 nonempty lists, including 55,721 singletons; 200,701 stored IDs, maximum 16. Full ID/cap/failure integrity audit passes. No core workaround or heap override.

## Classification / hand check / checks

Original 152: **19 restored; 0 identified wrong-before; 133 unverified by named fallback rules; 0 correct-and-provable under those rules still lost**. This is not a claim that Rust itself cannot prove the remaining calls. Each source position has its actual D16/later-probe, method/impl applicability, unknown receiver, opaque namespace or multi-namespace rule in round7-original-152.json.

Fresh seeded source inspection: **30 definite, 15 restored, 15 closed sets, 15 unresolved, 20 unverified project-hint links, 20 invalid-code causes**. No wrong definite, incomplete closed set, or wrong cause. The hint population intentionally includes some external actual callees; it is not misreported as 20 proven project callees. Two draft findings (cross-crate cfg and dependency-hint erasure) were fixed and natively confirmed. No further ordinary first-probe/path pattern was found in the final sample. Individual judgments and source excerpts are in round7-samples.json.

**31 native controls, 32 mutations killed.** Required checks ran sequentially: npm ci --ignore-scripts; supplied PYM_TLC_JAR npm test (**1,578 pass, 0 skipped**); format:check; Rust tests (**180 pass, 0 skipped**). All exit 0. Draft cancellations are explicitly not passes (round7-development-attempts.json).

Loaded-machine observations: direct module parse 37.4s, analysis 30.0s, resolve 26.1s, total 105.9s. Real store total 232.9s; parse 33.5s, analysis 28.7s, resolve 27.0s; peak RSS 5,134,984 KiB. Timings are observations, not assertions.

## Round 7 review response (d1694457)

Normal merges of current origin/main: 3400dd82 and 89d77a13. Rust runtime version 8. Same owned paths; no core, dependency or other-language edits. D16 no-toolchain scope is unchanged.

- **Opus B1 — glob precedence:** first-segment binding presence is independent of member-lookup completeness. Present declarations and explicit imports exclude glob fallback, including function/block scopes, child super globs, type/value/macro/import/pattern lookup. Conditional absence still keeps alternatives; enum globs supply variants, not associated members. Site audit: round8-scope-audit.md.
- **Sol S1 — inner cfg and every site:** one cached collector combines outer/inner cfg/cfg_attr and all enclosing AST gates. Module-file/root gates are combined with parent declarations. Same-crate caller implication remains structural; dependency feature names are independent. Conditional local/parameter bindings and conditional self parameters cannot prove presence. Fields, variants, arms, statements/expressions and block uses consume the same collector. Unknown cfg predicates remain unverified. Exact/sufficient caller conjuncts are proved before bounded full-DNF expansion, so unrelated complex predicates do not erase ordinary proved links.
- **Small backlog:** cfg-twin failed scopes cannot accuse every failed file; internal-parser-error paths use a path/parser reason without a receiver-type prefix. Both have killed mutations.

## Whole Vector

Fresh scratch clone at 515e87d9861b564f521a8992d224892cd8cae120; all *.rs through production indexer and fresh schema-3 store at the default Node heap. execArgv [], NODE_OPTIONS ''. All direct/store states, IDs and metadata are equal.

| Fact | 3dba60a8 | New |
|---|---:|---:|
| Claimed / clean / partial / failed | 1,563 / 1,552 / 0 / 11 | 1,563 / 1,552 / 0 / 11 |
| Symbols | 35,422 | 35,422 |
| Links | 365,514 | 365,514 |
| Definite | 75,950 | 76,125 |
| Closed sets | 88 | 90 |
| Unresolved | 289,476 | 289,299 |
| invalid-code | 247 | 247 |
| Failed-file uncertainty annotations | 175,075 | 175,056 |

Link-by-link **180 gains / 5 withdrawals / 0 retargets**. Kind/reason transitions and every changed decision are retained in round8-movement-*.json. All five withdrawals were inspected: two are contradictory unix/not(unix) field branches inside an already unix-only module; three require a Cargo feature-enabling relationship that is not a captured Rust predicate implication. The two new closed sets are local os_signals unix/windows functions, both captured; all 88 old closed sets remain. See round8-withdrawal-classification.json and round8-new-closed-sets.json. The same-module ablation (all fixes retained except leading inner attributes) moves 13 decisions: 10 restored and 3 made uncertain; no retargets. The other 170 gains come from glob/name precedence, outer/site gates and cfg proof; no definite dot dispatch was added. The 19 textual inner cfg/cfg_attr occurrences are listed in round8-vector-inner-cfg.txt; non-cfg payloads do not add gates.

The same 11 native-syntax-valid grammar gaps still fail completely; all are rechecked with rustc syntax parsing in round8-grammar.json. No code in them is a target. Full ID/cause/cap/no-closed-dot integrity passes. Reach audit validates every failed-file annotation. Remaining causes are sorted failed-file paths with no targets or hints.

Representation remains **unresolved-with-targets** (IDs only, cap 16; overflow has count and no list). 30,560 count-only links; 80,513 nonempty lists, 55,557 singleton lists. Analysis return: 163,280,974 → 163,551,621 bytes; graph facts 292,221,994 → 292,492,641. No heap override or core workaround.

Original 152 re-derived: 19 restored / 0 identified wrong-before / 133 unverified under named D16 rules / 0 correct-and-provable under that policy still lost. This does not claim the Rust toolchain cannot prove the remaining links. Per-row rules are in round8-original-152.json.

## Validation

Final required checks strictly sequential: npm ci --ignore-scripts; supplied PYM_TLC_JAR npm test (1,613 pass, 0 skipped); format:check; Rust tests (215 pass, 0 skipped). 48 scratch-only native controls; 42 mutations killed; baseline passes. Development attempts preserve the initial expectation/fixture fixes, one inadequate typed-self control, and the initial Vector precision loss from expanding unrelated cfg disjunctions. The strengthened fixture kills the receiver mutation; the bounded-prover regression kills removal of the conjunct shortcuts. A draft mutation runner omitted the previous round test file; it was corrected before the final pass. A cross-crate mutation was updated to disable both condition checks rather than only the now-redundant one. The pre-conjunct store draft completed, then its source-freeze guard stopped the pipeline while the cfg fix was being made; the final whole run repeats it with frozen source. No failed/cancelled run is counted as a pass.

Fresh seeded source samples and individual judgments: round8-samples.json. 135 fresh source inspections: 30 definite, 15 restored, 15 closed candidate sets, 15 unresolved, 20 unverified name-hint links, 20 invalid-code causes, plus 20 typed self calls with a captured same-file inherent body. No wrong definite, incomplete closed set or wrong cause. In the extra self population, 19 retain the known body; one macro-hidden module has no proved crate membership and remains plain unresolved (an existing macro-expansion limit). Some sampled hint links actually call std/external methods; they are not misreported as project callees. No further ordinary pattern provable under the stated fallback rules was found.

Loaded-machine observations: direct parse 51.1s, analysis 17.3s, resolve 16.2s, total 97.2s. Real store total 317.4s; parse 53.8s, analysis 22.7s, resolve 34.2s; peak RSS 5,305,896 KiB. Timings are observations, not assertions.

## Round 8 review response

Normal merges of current `origin/main` retained; Rust module version 9. Same owned paths, D16 scope and 16-ID hint cap. No core or other-language changes.

- **B1 — namespace-aware presence:** an explicit import excludes glob fallback only in a namespace it provably binds. Uncaptured external imports retain project alternatives as unverified hints. One shared filter handles type/value/macro lookup, including unit/tuple versus braced constructors, local/explicit imports, conditional families, enum variants, structural patterns and tuple patterns. Presence of a known type still excludes globs independently of the completeness of its associated-member lookup. The site audit is in `round9-scope-audit.md`.
- **B2 — failed globs are not causes:** an unreadable glob source has unknown exports; falling through to it is unresolved with `failed-file-unseen-declarations` and no cause. This supersedes the previous failed-glob-only positive control. Only named failed-module traversal and explicit non-glob imports through such modules establish `invalid-code`; captured explicit reexports retain their evidence. A merely possible fallback route cannot establish a cause either. Regression coverage includes all nine requested std/prelude names and the existing Option/None fixture.
- **Small — path reasons:** unresolved associated paths use `path-type-unverified`, never a receiver-type reason. Internal parser errors keep their existing path/parser reason.

Final required checks ran sequentially after the last source change and current main merge: `npm ci --ignore-scripts`; supplied `PYM_TLC_JAR` full suite (**1,660 pass, 0 skipped**); `format:check`; separate Rust tests (**262 pass, 0 skipped**). All exit 0; no process-test hang on this final run. Native controls and mutations run only in scratch copies; the module and its tests never invoke Rust. Earlier unfinished development measurements are recorded explicitly as unfinished, never passes.

### Whole Vector against d1694457

Pinned commit remains `515e87d9861b564f521a8992d224892cd8cae120`; all 1,563 Rust files through a fresh schema-3 production store. Default heap: `execArgv: []`, `NODE_OPTIONS: ""`. No analysis/resolution errors. Every one of the **365,514 stored link facts equals direct output**, including state, target IDs and all metadata (`round9-equality.json`).

| Fact | d1694457 | Version 9 |
|---|---:|---:|
| Clean / partial / failed files | 1,552 / 0 / 11 | 1,552 / 0 / 11 |
| Symbols / links | 35,422 / 365,514 | 35,422 / 365,514 |
| Definite / closed sets / unresolved | 76,125 / 90 / 289,299 | 76,125 / 90 / 289,299 |
| invalid-code | 247 | 247 |
| Failed-file uncertainty annotations | 175,056 | 175,055 |

**0 gains / 0 withdrawals / 0 retargets.** Exactly **one hint-list change**, no removed hint IDs: `Record` in `src/sinks/aws_kinesis/streams/integration_tests.rs` retains the project `Record` trait beside its unknown external import namespace. The actual source import is SDK `Record`; the project alternative is explicitly unverified, not claimed as that external type. Its opaque fallback reason replaces the old opaque/reach reason, clearing one reach annotation. No count-only lists change. B2 changes **0 of Vector's 247 causes**: none came from an unreadable glob source. Captured explicit reexports in valid modules keep their named traversal evidence.

There are 26,670 path-prefix-only reason changes, plus 380 path-prefix changes among 2,764 other reason-text changes. The latter preserve every decision, target list/count and cause: after normalizing the path prefix, 1,123 only differ in ordering/duplication; 1,173 add opaque-scope fallback context; 466 replace generic unknown-structure text with that context; two replace it with namespace-binding-unverified. This is B1's retained fallback, not new dispatch proof (`round9-reason-classification.json`).

Hints remain IDs only, capped at 16: **30,560 overflow counts; 80,514 nonempty lists; 55,558 singletons; 200,524 stored hint IDs**. Analysis return bytes: 163,551,621 → 163,744,929; graph-fact bytes: 292,492,641 → 292,685,949. The added pattern-namespace marker and reason text account for the small metadata growth. Full integrity audit passes; no closed dot sets, failed-file targets or truncated lists.

Native syntax acceptance of the same 11 grammar gaps remains as recorded in round8-grammar.json; this patch changes no grammar or parse-failure policy. They still fail completely, contributing no symbols or links. No grammar special cases were added.

**48 native controls; 47 mutations killed; baseline passes.** The namespace, failed-glob and path-reason mutations fail the new regressions. Source/tests are frozen across checks, mutations, direct analysis and store measurement. Fresh source judgments are in `round9-samples.json`: 30 definite, 15 closed sets, 15 unresolved, 20 unverified project-hint lists and 20 causes. No new wrong definite/closed set or wrong cause was identified; std/external actual callees are explicitly distinguished from project name hints. The existing macro-hidden Windows module remains unplaced without expansion and is not claimed as a new precision gain.

Loaded-machine observations: direct parse 110.8s, analysis 48.9s, resolve 48.0s, total 225.3s. Production-store run 413.3s; parse 83.9s, analysis 45.8s, resolve 62.6s; peak RSS 5,348,332 KiB. Timings are observations, not acceptance assertions.

The traversal-instrumented scratch resolver reproduces every original decision/hint/count/reason/cause before accepting its evidence: **all 247 remaining causes have named witnesses — 19 direct module/crate paths or declarations (i), 228 captured explicit non-glob imports/reexport chains (ii)** (`round9-cause-audit.json`). The independent manifest/module audit validates every **175,055** reach annotation. Neither audit edits production facts. Original 152 re-derived unchanged: **19 restored / 0 identified wrong-before / 133 unverified by named D16 rules / 0 correct-and-provable under that fallback policy still lost** (`round9-original-152.json`). This is not a claim that Rust itself cannot prove those 133 links.

## Round 9 review response (version 10)

Same owned paths; normal merge of current `origin/main` retained. No core or other-language edits. The module remains the D16 no-toolchain fallback.

- **B1 — syntactic namespace:** one `referencePosition` classifier separates match patterns from their condition/guard expressions, including struct heads and casts. Type/value/macro lookup follows the local syntax; unknown callee forms cannot prove a semantic target. The node-kind inventory and same-name controls are in `round10-scope-and-presence-audit.md`.
- **B2 — inner possible shadow:** an unproved inner import, glob or opaque item source defeats an outer failed-file cause. Captured project alternatives are retained, while proved different-namespace bindings leave the outer route intact. Negative namespace proofs are not cached when a cycle/depth guard cut the lookup. A repeated import cannot grow its own suffix indefinitely; shrinking recursive reexport paths remain supported.
- **W1 — editions:** package default/inherited/literal editions and target overrides drive both import links and forwarded bindings. 2015 imports root at the crate; modern imports use uniform paths and the extern prelude. Unknown edition retains both routes without selecting a winner. Explicit extern-crate aliases are captured.
- **W2 — dependency conditions:** target cfg, optional activation and normal/dev/build scope remain on each edge. Same-manifest routes are a disjunction, rather than an unconditional flattened map or a conjunction of unrelated routes. Only an implied route proves binding/reach. Sysroot/prelude collisions use the conservative policy stated above.
- **W3 — present-as-written:** one predicate blocks every semantic proof through an opaque attribute on the item or any enclosing item/file-module declaration. Would-be targets are retained with `item-under-opaque-attribute`. `contains` stays a definite structural relationship, and every affected symbol carries `underOpaqueAttribute` plus its inherited attribute paths. Removing the attribute clears cached-child markings on re-analysis.

Source-site audit, native controls, development attempts and final source hashes are retained under `evidence/w2-c/round10-*`. The module and its tests never invoke rustc/Cargo; compiler controls and mutations run in scratch only.

### Whole Vector against c61bdccc

Fresh clone at `515e87d9861b564f521a8992d224892cd8cae120`; all 1,563 Rust files through direct analysis and a fresh schema-3 production store. Default Node heap: `execArgv: []`, `NODE_OPTIONS: ""`; no core workaround. Every **365,530 link fact** and every symbol position/metadata field agrees between direct and stored output, including opacity flags (`round10-equality.json`). No analysis or resolution errors.

| Fact | c61bdccc | Version 10 |
|---|---:|---:|
| Clean / partial / failed files | 1,552 / 0 / 11 | 1,552 / 0 / 11 |
| Symbols | 35,422 | 35,422 |
| Links | 365,514 | 365,530 |
| Definite | 76,125 | 67,638 |
| Closed sets | 90 | 90 |
| Unresolved | 289,299 | 297,802 |
| invalid-code | 247 | 170 |
| Failed-file uncertainty annotations | 175,055 | 175,683 |

Shared links: **1,525 gains / 10,014 withdrawals / 0 retargets**. No removed links. Sixteen added links are captured `extern crate` imports (two definite, fourteen unresolved). All 90 closed sets remain; no closed dot-call set exists. The gains are 1,200 type references, 188 imports, 93 calls (nine dot calls), 27 values and 17 patterns. A scratch ablation removing the new explicit extern-crate bindings and restoring the old builtin catalog loses all 1,525 proofs; restoring only the old builtin catalog loses 175, while the old negative-cache policy alone loses none. These are import/builtin-presence precision gains, not broader dispatch. Fresh gain samples include root `Result`/`Error` reexports and an exact `&mut SourceShutdownCoordinator` receiver.

Exactly **10,012 withdrawals are W3 semantic-presence cost**. The other two are dependency-conditioned `super::arrow` and `super::reply::protobuf` imports whose activation is not implied by captured site predicates. A Cargo feature closure might enable them in a native build; this fallback does not solve that closure. The two would-be project targets remain listed.

B2 clears 77 old causes, with zero new causes. All 77 remain cleared in the full W3-disabled experiment, so this is not charged to strict item presence. Every remaining cause has a named witness: **19 direct module/crate paths or module declarations; 151 explicit non-glob imports/reexport chains**. The independent reach audit validates all **175,683** annotations. The net reach change is +628: 701 shared links gain the annotation, 79 clear it, and six added extern-crate links carry it. Mere missing names, failed globs and possible inner-shadow routes do not accuse files.

### W3 semantic cost and structural markers

The ablation runs a **fresh parse, analysis and resolution** with only `itemPresence` disabled in a scratch module. A withdrawal is attributed to W3 only when that otherwise-final module proves the same old target. A read-only ownership trace first reproduces every production decision, hint/count, reason, cause and attribute list; it then records indirect opaque self-type blockers. **328** W3 withdrawals have indirect impl/receiver applicability blockers rather than an attribute list on the link itself. Their source blockers are retained in `round10-w3-cost.json`.

**10,012 semantic links withdrawn; 9,394 retain exactly one would-be target.** Every former target is retained in the uncapped inventory, including links whose public representation is count-only overflow. **5,549 / 35,422 symbols** carry `underOpaqueAttribute: true` and sorted inherited paths. **Zero structural contains withdrawals**: all 33,870 containment edges remain definite facts about captured text.

| Semantic link kind | W3 withdrawals |
|---|---:|
| types | 6,079 |
| patterns | 1,670 |
| calls | 1,178 |
| values | 735 |
| implements | 218 |
| imports | 132 |

Top 15 attribute-path blockers follow. Counts are **non-exclusive**: one link can have several blockers, including a retained alternative impl whose nominal type is opaque. These are source dependencies preventing proof, not claims that removing each individual path alone would restore the link. The exact combinations and per-link rows are retained in the cost JSON.

| Attribute path | Withdrawn semantic links with that blocker |
|---|---:|
| `configurable_component` | 6,233 |
| `serde` | 5,666 |
| `configurable` | 1,719 |
| `snafu` | 636 |
| `serde_as` | 615 |
| `derivative` | 522 |
| `async_trait` | 441 |
| `default` | 356 |
| `pin_project` | 278 |
| `typetag::serde` | 275 |
| `strum` | 270 |
| `command` | 174 |
| `display` | 167 |
| `tokio::test` | 104 |
| `enum_dispatch` | 48 |

This deliberately strict rule also treats helper-looking attributes such as `serde`, `configurable`, `default` and `snafu` as opaque unless on the explicit builtin list. The module does not assume that a familiar name is harmless. The owner can use the measured cost to decide a later policy change; this patch adds no special cases.

Hints remain **unresolved-with-targets**, IDs only, cap 16. There are **31,522 count-only overflows; 88,055 nonempty lists; 62,964 singleton lists; 208,996 retained hint IDs**. Analysis return bytes: **163,744,929 → 170,130,391**; graph-fact bytes: **292,685,949 → 299,076,732**. The full production store succeeds at the default heap. Its observed peak RSS is 5,350,360 KiB; elapsed 237.4s, parse 48.1s, analysis 24.9s, resolution 22.2s. Direct parse/analysis/resolution timings are in the Vector summary. These are loaded-machine observations, not timing assertions.

The same **11 native-syntax-valid grammar gaps** still fail completely and contribute no symbols or links. Their individual native checks and rejected constructs remain recorded in `round8-grammar.json`; neither the grammar nor the whole-file failure contract changed. These valid Rust files being failed by the grammar remain a real limitation, not invalid user source or a passed parser property.

### Classification, source inspection and validation

Original 152 re-derived: **12 restored / 0 newly identified wrong-before / 140 unverified under named fallback rules / 0 further correct-and-provable under that policy identified still lost** (`round10-original-152.json`). Seven formerly restored links become unverified under W3: #64, #65, #67, #68 (`TagValueSet` methods), #144 (`peer_addr`), #146 and #147 (`Self::Tls`/`Self::Raw`). This is the declared presence-policy cost, not a claim that Rust cannot prove those calls. Every unverified row names its actual current rule.

Fresh seeded manual source inspection: **30 definite, 15 gains, 30 withdrawals, 15 closed sets, 15 unresolved, 20 project-hint links, 20 failed-file causes**. No wrong definite, incomplete closed set or wrong cause identified. Std/external and generic actual callees are distinguished from broad project name hints; the sample is not misreported as 20 proven project callees. Excerpts and individual judgments are in `round10-samples.json` and `round10-sample-judgments.json`.

Final required checks ran strictly sequentially with frozen source/tests: `npm ci --ignore-scripts`; supplied `PYM_TLC_JAR` full `npm test` (**1,755 pass, 0 skipped**); `npm run format:check`; separate Rust tests (**357 pass, 0 skipped**). All exit 0, with no process-test hang. **68 native controls** (41 rustc, 27 offline Cargo), plus all three supplied production reproductions, pass. **54 mutations killed**, baseline passes. Mutated modules and native controls are scratch-only; runtime/tests never invoke Rust/Cargo.

Development attempts are explicitly separated from acceptance in `round10-development-notes.md`: the initial duplicate dependency-route defect, rejected draft controls, stopped expanding-import probes and incomplete attribution attempts are not passes. Experimental lookup caches were removed; the shipped fix is the small self-expanding-import guard, with a native shrinking-reexport control. Source hashes, final completion assertions, full equality, cause/reach/hint integrity and ablation evidence are under `evidence/w2-c/round10-*`.

## Round 11: structural TOML and contextual attribute identity — rejected strict variant

The figures in this section record fb8dd01a before E4. Its strict unseen-code shadow policy for derive/global_allocator was rejected; the round-12 section and current E4 rule above supersede that policy. These measurements are preserved, not rewritten.

The three round-10 blockers were addressed together:

1. **Cargo facts come from parsed TOML.** Quoted/escaped/dotted keys, inline/standard tables, arrays of tables and string spellings share one normalized tree. Package/workspace/per-target editions use that tree; unreadable documents and unread edition values never default to 2015. Other dependent facts and their unknown behavior are described above. The 48 full-fact spelling fixtures independently normalize with Python `tomllib`; 36 offline Cargo programs cover the actual compiler-facing controls, including table/inline inheritance, quoted editions, both bin-edition directions, collisions and explicit `dep:` activation. All 41 Vector manifests are understood; all 92 target roots and their editions agree with the baseline. Captured workspace patch selection remains unverified, rather than assuming registry/version selection; this changes metadata for an external route, not Vector's definite project targets.
2. **Unshadowed test/bench functions imply `cfg(test)`.** These conditions use the existing implication/alternative logic, including cfg_attr and a caller already under test. An attributed function called from a cfg(test) module can still be definite. Compiler controls accept the normal and test-harness programs. Unsupported test_case/cfg_eval/cfg_accessible transformations stay opaque. Proc-macro declaration attributes preserve the source function's structural identity, but export the macro name in the macro namespace; the ordinary function facet is local to its defining crate. This avoids changing structural target IDs.
3. **Attribute spelling is not identity.** The three-class table above replaces the old flat inert-name list. Explicit/local bindings, unknown item generation, macro-use extern imports and registered-tool dependency names can defeat proof of a prelude/tool meaning. A glob use does not shadow the standard attribute. Impossible cfg_attr payloads do not add opacity, and qualified payload names retain their full path. Native controls include the reviewers' replacement impl/tool program, every shadowable head, the bare imported replacement, and macro-use/tool-dependency routes. Contains stays structural; semantic links require presence-as-written. Re-indexing recomputes contextual gates and opacity, including cached child files.

### Vector cost — semantic links only

**The strict shadowing rule withdraws 11,730 definite semantic links (34.7% of the baseline's 33,768 definite semantic links).** This is larger than the expected small change: uncaptured `#[macro_use] extern crate` exports can replace prelude attribute macros, including `derive` and `test`; item-generation/explicit binding routes also prevent proving an unshadowed meaning. The native macro-use control is accepted and demonstrates replacement. The module does not assume the external crate's exports from its familiar name.

Fresh full counterfactual runs disable only shadow classification or only implicit test/bench gates. **Every one of the 11,730 withdrawals restores its exact baseline target when shadow classification is disabled; none restores when only test/bench gates are disabled.** Thus no Vector withdrawal is charged to the TOML reader or test/bench gate itself. All per-link classifications are retained in `round11-attribution.json`; these ablations never edit production facts.

| Withdrawn semantic kind | Count |
|---|---:|
| types | 8,112 |
| calls | 1,474 |
| patterns | 1,126 |
| imports | 508 |
| values | 501 |
| implements | 9 |

Only two attribute paths occur as direct reported blockers in these withdrawals, so there are no additional top-15 paths to list:

| Reported path | Withdrawals carrying this blocker (non-exclusive) |
|---|---:|
| derive | 11,141 |
| test | 217 |

Eight carry both paths. Another 380 have indirect scope/receiver/impl-applicability effects without a direct attribute-path field. They are included in the counterfactual proof, not guessed from their message. Broad uncertainty propagation can keep an intact type's first-step method unverified when another impl's nominal self type becomes unknown. This is the retained “unproven is not absent” rule.

**11,293 withdrawals keep exactly one would-be target.** All 11,730 former target IDs occur in the full new hint inventory, checked before the cap; six use count-only overflow. The four gains are explicit import/reexport links to the exported derive name `NamedInternalEvent`, whose written function is `derive_internal_event_name`. Native export/import controls pin that namespace distinction. There are **0 retargets, 0 added/removed links, and all 90 old closed sets keep exactly the same IDs**. No dot call acquires a closed set. All **33,870 contains** links remain definite. Opaque-marked symbols: **5,549 → 10,503**.

Fresh pinned Vector (`515e87d9861b564f521a8992d224892cd8cae120`) at the default heap:

| Result | 81aba89e → current |
|---|---:|
| files | 1,563 → 1,563 |
| clean / partial / failed | 1,552 / 0 / 11 → unchanged |
| symbols / links | 35,422 / 365,530 → unchanged |
| definite | 67,638 → 55,912 |
| closed sets | 90 → 90 |
| unresolved | 297,802 → 309,528 |
| invalid-code | 170 → 168 |
| failed-file reach annotations | 175,683 → 176,535 |
| analysis return bytes | 170,130,391 → 177,326,471 |
| graph-fact bytes | 299,076,732 → 304,931,139 |

The two removed causes are the ConfigBuilder import inside an opaque test input and the `tracing_limit::RateLimitedLayer::new` path whose binding is no longer provable under opaque scope generation. Both remain unresolved, with reach uncertainty and no guessed cause. All 168 remaining causes reproduce with named traversal witnesses: 18 module/crate paths/declarations and 150 explicit non-glob import/reexport chains. Every one of the 176,535 reach annotations has a captured ownership/dependency path. The reach changes are 940 additions (939 calls, one import) and 88 cleared import annotations, as lookup proof changes under opacity/macro export classification; no new failed file is introduced.

Hints remain bounded and unverified: **31,605 count-only overflows; 99,795 nonempty lists; 74,226 singleton lists; 222,378 retained IDs**. Full production indexing/store completes with execArgv=[], NODE_OPTIONS empty and Node heap limit 4,496,293,888 bytes. Every link state/target/metadata and every symbol position/metadata equals the direct run. Observed store elapsed 292.1s and peak RSS 5,315,400 KiB are loaded-machine observations, not acceptance timing bounds. No core edit or increased heap is used.

The same **11 real, syntax-valid grammar-gap files** still fail completely. They contribute no symbols/links; `src/config/builder.rs` and the other rejected constructs remain listed in `round8-grammar.json` with native syntax evidence. The grammar is unchanged. This is still failure of valid Rust due to grammar limitations, not evidence that the user's Rust is invalid or that all of Vector was cargo-typechecked.

### Checks and source inspection

After normally merging the newly landed TypeScript module (9a1b7c2f), final frozen checks ran sequentially, all exit 0: npm ci --ignore-scripts; supplied PYM_TLC_JAR npm test (**2,049 pass, 0 skipped**); format:check; Rust tests (**523 pass, 0 skipped**). No process-test hang occurred. **67 mutations killed**, with an unmodified passing baseline and syntax checks on every mutated JS module; missing-package errors cannot count as kills. The 13 new mutations cover unread edition/TOML recovery, test/bench gates, shadowing/glob distinction, dead cfg_attr payloads/full paths, bare opacity, collisions, bin edition, optional dep activation and macro-use shadowing. Native evidence includes 48 rustc controls (one unmodeled test_case observation), 36 offline Cargo controls, 63 attribute classification probes, and the tool-dependency replacement control. Runtime/install/module tests never need the compiler.

Fresh seeded source inspection: **30 definite, all 4 gains, 30 withdrawals, 15 closed sets, 15 unresolved, 20 project-hint links, 20 failed-file causes**. Individual judgments distinguish broad std/external/generic name hints from actual captured callees; none is silently upgraded to a compiler answer. All prior withdrawn IDs remain in the uncapped inventory. Original 152 re-derived: **5 restored / 147 unverified under named fallback rules / 0 newly identified wrong-before / 0 further provable under that policy identified still lost**. Seven of the preceding 12 restored links now pay the shadowing/presence cost; this is not a claim that rustc cannot resolve them. Intermediate/rejected attempts are identified in `round11-development-notes.md`. Full equality, source hashes, movement, attribution, samples and audits are under `evidence/w2-c/round11-*`.


## Round 12: E4 visible bindings for derive/global_allocator

E4 is an explicit no-toolchain fallback assumption: unseen code is assumed not to rebind `derive` or `global_allocator`. It does not weaken `test`/`bench` or tool-prefix classification. A shared `attributeBindingShadows` predicate reads the two heads' `shadowing: visible` classification; parser, inherited/cross-file attribute context and path-opacity lookup all use it. Captured macro-use import requests retain their source crate and optional name list. Readable captured macro exports remain visible bindings, including public module-glob forwarding and private module aliases. Their names propagate through a finite captured-module graph; function-local imports are excluded, conditional macro kinds remain possible, and an import-edge guard bounds alias expansion. This is positive binding evidence, not a claim of export completeness. Such captured bindings; missing/unreadable exports do not manufacture one.

**Known limit (deliberate):** an uncaptured proc-macro crate can export an attribute named `derive`; `#[macro_use] extern crate pm; #[derive] impl A { fn f(self)->u8 {1} }` can replace that input with `impl Tr for A { fn f(self)->u16 {2} }`. Native Rust accepts it and calls the generated trait method (2). Under E4 the fallback can keep a definite link to the written inherent method (1), because it assumes the unseen export does not bind `derive`. The same counterexample works for `global_allocator`. These are labelled **known limit E4** tests asserting current behavior, with compiler evidence in `round12-rustc.json`. An explicit `use pm::derive`, a named `#[macro_use(derive)]` list even from an uncaptured crate, or readable captured macro-use exports, stays opaque and does not get this exception. Compiler-backed precision belongs to D17. This assumption must not be presented as compiler correctness.

Unseen item/attribute output policy controls also assert E4's chosen behavior. Native probes distinguish these from accepted counterexamples: importing a replacement through more-expanded output can produce E0659 ambiguity. Rejected probes are not counted as accepted programs. The uncaptured macro-use counterexamples themselves are accepted and demonstrate the actual limit.

### Whole Vector: accepted E4 variant vs 81aba89e

**4 gains / 451 withdrawals / 0 retargets. E4 restores 11,279 of the rejected variant's 11,730 withdrawals, without withdrawing or retargeting any link it had proved.** The remaining cost is 1.34% of the baseline's 33,768 definite semantic links, rather than the rejected 34.7%.

Every remaining withdrawal is attributed, link by link, to **strict test/bench shadowing**: a fresh counterfactual disabling only those heads' shadow classification restores the exact baseline target ID for all 451. There are 217 direct `test` blockers and 234 indirect scope/path effects from potentially generated bindings. No remaining withdrawal reports `derive` or `global_allocator` as a blocker. **Tool-prefix cost is 0 withdrawals and 0 changed decisions** in the complete tool-only counterfactual; tools remain strict. Disabling all shadow classification gives the same definite results as the test/bench-only counterfactual. The production facts are never edited by these probes (`round12-attribution.json`).

| Remaining withdrawn semantic kind | Count |
|---|---:|
| types | 260 |
| calls | 114 |
| values | 53 |
| patterns | 16 |
| imports | 5 |
| implements | 3 |

All 451 previous target IDs remain in the full new hint inventory; **445 have exactly one would-be target**, six have multiple targets, and none requires overflow. These remain unverified, not definite answers. All 90 old closed sets retain identical IDs; no dot call has a closed set. All 33,870 contains links stay definite. Opaque-marked symbols are **8,320**, down from 10,503 in the rejected variant (baseline 5,549); the retained test/bench uncertainty can mark nested items even when no semantic link uses them. The four gains vs 81aba89e are the same NamedInternalEvent import/reexport links from round 11's macro-export namespace fix; E4 adds no new gain beyond the baseline's former targets.

Fresh full parse/analysis/resolution and full production indexer/store use pinned Vector `515e87d9861b564f521a8992d224892cd8cae120`:

| Result | 81aba89e → E4 |
|---|---:|
| files | 1,563 → 1,563 |
| clean / partial / failed | 1,552 / 0 / 11 → unchanged |
| symbols / links | 35,422 / 365,530 → unchanged |
| definite | 67,638 → 67,191 |
| closed sets | 90 → 90 |
| unresolved | 297,802 → 298,249 |
| invalid-code | 170 → 168 |
| failed-file reach annotations | 175,683 → 175,621 |
| analysis return bytes | 170,130,391 → 173,332,402 |
| graph-fact bytes | 299,076,732 → 300,720,139 |

All 168 remaining causes have named failed-module traversal witnesses (18 direct module/crate paths/declarations; 150 explicit non-glob import/reexport chains). The same two conservative cause removals as round 11 remain: the opaque-test ConfigBuilder import and an unproved tracing_limit path. Both remain unresolved, not falsely assigned a cause. Every reach annotation has a captured dependency/module path. Reach changes are 26 additions (25 calls and one import) and 88 cleared import annotations. The **same 11 native-syntax-valid grammar gaps** fail completely and supply no targets; E4 does not alter the grammar or the whole-file failure rule. Their per-file syntax evidence remains in round8-grammar.json; no whole-Vector Cargo typecheck is claimed.

Hint totals: **31,526 count-only overflows; 88,594 nonempty lists; 63,456 singleton lists; 209,584 retained IDs**. The full production store completes at the default heap: execArgv=[], NODE_OPTIONS empty, heap limit 4,496,293,888 bytes; all link decisions/metadata and symbol positions/metadata equal the direct run. Observed elapsed 405.5s and peak RSS 5,436,612 KiB are loaded-machine observations, not acceptance bounds. The final raw-identifier normalization is also checked to change no Vector link, symbol or file-context fact; all acceptance snapshots come from the final source.

### Validation and recorded limits

Current main, including E4, is normally merged. Required checks run sequentially with frozen implementation/tests: npm ci --ignore-scripts; supplied PYM_TLC_JAR npm test (**2,079 pass, 0 skipped**); format:check; Rust tests (**553 pass, 0 skipped**). All exit 0, no process-test hang. **72 mutations killed** with a passing unmodified baseline: the 67 retained rules and five E4 controls (unseen code shadows derive; readable exports ignored; visible bindings ignored; conditional exports absent; alias-edge guard removed). Mutated JS is syntax-checked and missing-package errors cannot count as kills. No core, grammar, other-language or dependency code changes.

Native evidence records **19 accepted controls and 8 expected E0659 ambiguity rejections**, separately classified. Accepted controls include macro-use/named macro-use replacement of both E4 heads, visible named replacements, strict test/bench replacements, raw named exports, module/glob and private-alias forwarding, unexported/function-local negatives, and conditional exports. Known-limit tests deliberately assert the E4 assumption's behavior; they do not masquerade as compiler agreement. Module runtime, installation and tests never invoke Rust/Cargo.

Fresh source inspection: 30 definite, all four gains, 30 remaining withdrawals, 15 unchanged closed sets, 15 unresolved, 20 project-hint links and 20 named failed-file causes. Broad std/external/generic name hints are identified as such rather than called actual project callees. Original 152 classification returns to **12 restored / 140 unverified under the fallback policy / 0 newly identified wrong-before / 0 further provable under that policy identified still lost**. “Proved” here is conditional on the explicit E4 assumption, not compiler-backed completeness. Full source hashes, movement, attribution, equality, native controls and samples are in `evidence/w2-c/round12-*`; round11 retains the rejected variant. Development attempts are separated in round12-development-notes.md.


## Round 13 — named macro-use is a visible binding

Review round 11's B1 is fixed: a named `#[macro_use(derive)]` or `#[macro_use(global_allocator)]` list itself proves a visible binding, regardless of whether the exporting crate is captured. The collector no longer excludes these E4 heads. Their input items and descendants are marked opaque, and semantic links retain would-be targets rather than proving the written item exists. Bare unknown-export macro-use and opaque generated output retain the E4 assumption; named lists are **not** a known limit. Earlier round12 native records are preserved as history; their named-list fallback-policy labels are superseded by round13-rustc.json.

The two former named-list known-limit tests now assert opacity. Additional tests isolate named `macro_use(test)` under a `cfg(test)` caller and pin `edition-unverified` when unsupported TOML datetime metadata makes an inherited edition unknown. Datetime support itself remains outside this fix. Module version 13 invalidates prior cached parse results. Compiler controls include the exact empty-output replacement route for derive/global_allocator/test: Rust calls the existing trait method and returns 2.

Against pushed **9aa746c4**, Vector has **0 gains / 0 withdrawals / 0 retargets**, and **zero changed link facts** (byte-identical link snapshots). All context and symbol facts are identical too. There are no named `macro_use(...)` lists anywhere in the pinned Vector sources. Totals remain **1,563 files (1,552 clean / 11 failed), 35,422 symbols, 365,530 links: 67,191 resolved / 90 candidate sets / 298,249 unresolved**. All 168 failed-file causes and the E4 round12 attribution are unchanged. The eleven failed files remain documented valid-Rust grammar gaps; this patch does not change grammar behavior.

Required sequential checks pass: `npm ci --ignore-scripts`; full `npm test` with PYM_TLC_JAR (**2,081/2,081**); `format:check`; Rust tests (**555/555**). **75/75 mutations are killed**, with a passing final module-v13 baseline. The named-test mutation fails its new cfg(test) test; accepting the unsupported datetime fails its new edition-unverified test. Native controls record the exact named-list empty-output replacement as accepted for all three heads; the existing bare E4 counterexamples remain labelled known limits. Evidence: `evidence/w2-c/round13-*`; prior evidence remains intact.

The full production indexer/store run also completes at the **default Node heap**, with module version 13: no analysis errors or resolution errors, the same eleven grammar-gap failures, and every stored link fact and symbol equal to the direct run (`round13-store.json`, `round13-equality.json`). No core edits or heap overrides.


## Round 14 — one effective attribute reading

Review round 12 B1 and the namespace extra are fixed. `applications()` is the shared cfg_attr/unsafe expander; `effectiveAttributes(item)` applies it to the item's outer/inner attributes. A payload participates unless its predicate, conjoined with the enclosing explicit conditions, is provably false. Named macro-use payloads populate a separate macro-name set. Crate names/aliases can shadow tool prefixes, but do not bind prelude attribute macros. Bare unknown exports retain E4; test/bench remain strict. Module version 14 refreshes cached parses.

The parser now supplies effective, guarded namespace-attribute records to the resolver. The resolver no longer independently expands cfg_attr or unsafe wrappers. Macro-export visibility and module-path selection use the same effective reading; impossible path/export payloads are ignored and provably active paths are explicit. Captured source attribute strings on symbols remain unchanged for display.

Literal attribute-name audit (all Rust module sources):

| Read / consumer | Effective reading status |
| --- | --- |
| `macro_use`, extern-crate named and bare binding collection | **Now fixed:** effective applications; named names kept separately from crate aliases |
| `macro_use`, resolver macro-import namespace annotation | **Now fixed:** parser's effective named records; deleted independent raw cfg_attr recursion |
| `macro_export`, macro visibility and path binding | **Effective reading:** guards are retained; only an export implied by the item gates records public visibility. Conditional exports are conditional crate-root path bindings, not lexical-module bindings |
| `path`, module layout | **Now fixed:** effective applications replace independent cfg_attr recursion; guard implication distinguishes definite/possible paths |
| `proc_macro`, `proc_macro_attribute`, `proc_macro_derive` | **Yes:** procMacro() consumes applications, preserving conditional macro-kind uncertainty and derive export names |
| `derive`, local binding-type opacity | **Yes:** bindingAttributeOpaque() consumes applications |
| `derive` and builtin/prelude/tool classification, item presence and shadowable contexts | **Yes:** opaquePresence()/shadowableOn() consume applications |
| `derive`, resolver standard-derive namespace annotation and general attribute classification | **Yes:** consumes parser's effective guarded records; no raw wrapper expansion remains |
| `test` / `bench`, implicit conditions | **Not a literal presence check:** the conditionalAttributes table feeds cfg()/implicitConditionsOn(); their recursive cfg_attr implication preserves the predicate rather than treating a conditional attribute as unconditional |
| `cfg` / `cfg_attr`, explicit and inherited conditions | **Interpreter, not a binding check:** cfg() recursively encodes `predicate implies payload condition`; applications() uses those conditions to discard impossible payloads |
| `cfg_attr` / `unsafe`, applications() | **The one effective reader:** unwraps nested payloads and carries guards |
| `cfg_attr`, implicitConditionsOn() | **Condition interpreter:** records guarded implicit test/bench conditions, not a second binding-presence decision |
| `not` / `all` / `any`, predicate parser | **Not attributes:** cfg predicate grammar only |
| attributeRules name table / original `attributes` symbol strings | **Not presence tests:** classification data and captured source display; never literal wrapper-based binding proof |

### Module-file inner attribute audit (round 17)

A file unit's leading inner attributes use the same `effectiveAttributes()` / `applications()` reader as an inline module's body. Clean-file controls join the mod declaration **per captured body/layout**, not as an unconditional union across alternative files. The native legality matrix records all 65 attempted table/tool spellings, including both cfg(test) modes for test/bench; it distinguishes accepted attributes (some warn and are ignored), target/feature/architecture rejections, and custom-inner-attribute instability. Exact diagnostics and runnable controls are in round17-rustc.json/.mjs and round17-module-controls.json/.mjs.

| Attribute read on a module | Clean child FILE inner form | Failed child FILE inner form / consequence |
| --- | --- | --- |
| cfg; cfg_attr carrying cfg | Legal. File-unit conditions join the declaration/module scope and apply to descendants; outer/inner gates are conjoined. Existing condition interpretation is retained | No attributes or items are recovered. Unknown inner cfg may disable the module but cannot introduce a definite link into it: the failed file contributes **no symbols or links**, and named traversal still follows the failed-file rule |
| macro_use; nested/conditional cfg_attr carrying macro_use | Legal in non-root module files in 2015/2018/2024. Effective file-unit guards join declaration guards for that body, and its ending textual scope transfers at the end of the mod item. A provably false payload does not transfer. Named arguments are rejected on modules; named extern-crate import lists remain a separate supported route | **Unknown, never absent by default.** A possible unseen entry transfers even without outer macro_use. It is gated by captured declaration/ancestor conditions, so cfg(any()) on the mod item removes it; before-mod sites are unaffected |
| path; cfg_attr carrying path | Legal in a module file; illegal at crate root. It does **not** replace the already loaded file. **Round 18 correction:** inner-file and inline-module directory tracking is unverified, even for plain values; captured filename alternatives are would-be files only. A first, unconditional outer file-module path wins and makes a later inner path unused. Plain outer file-module paths retain the verified captured-file rule. Exotic values never prove a layout | No inner path or child mod declarations are guessed. No target inside the failed file exists. Children whose only ownership declaration was lost remain unowned/unresolved |
| Opaque/project proc-macro attribute; shadowable tool/prelude attribute | Leading file opacity applies to the module declaration as well as its file unit and contents, using the existing one presence predicate. Contains stays structural. Custom inner attributes are unstable on this stable rustc; the fallback nevertheless withholds proof on parsed opaque input | No opaque item is salvaged as a target. Possible leaked textual macro scope is covered by the failed-file unknown macro_use entry |
| proc_macro / proc_macro_attribute / proc_macro_derive | Rejected on modules. These transform captured function items only; a module/file unit is not made into a macro export | No macro symbol is fabricated from a failed file |
| test / bench (including cfg_attr payloads) | Rejected as inner module attributes on stable (also checked under cfg(test)). The fallback's non-function conditional target stays unverified; it never treats these as unconditional module-presence proof | No body targets exist regardless of unreadable conditional attributes |
| no_implicit_prelude | Legal. Its effective flag is inherited by child scopes from either declaration or file header. Bare Cargo extern-prelude bindings are unverified there; `::dep` and explicit extern-crate bindings retain their explicit rules. Local written items remain linkable. Standard prelude/trait dispatch is still not positively resolved | No failed body can supply prelude-dependent item targets; no flag or ancestry is inferred from its text |
| macro_export on the module itself | Accepted with a warning and ignored by rustc. It does not export every macro in the file. Only each definition's own effective macro_export creates its crate-root path binding | No failed macro definition/export is recovered |
| allow/warn/deny/forbid/expect, doc, deprecated; other non-removing builtin metadata | Leading inner forms go through the same classification and are retained. The native matrix lists each accepted or rejected placement. Root-only flags (crate_name/type, no_std/no_main, limits, etc.) and misplaced metadata may be accepted with warnings and ignored; no item removal is inferred | No metadata is recovered or used to authorize targets |
| Any other attribute | Opaque through the same classification, including full paths and cfg_attr payload guards; no second file-header allowlist | Unreadable/unknown, with no target-bearing declarations |

This is a structural fallback, not Rust's attribute target validator: compiler-rejected target placements, unstable features and tool registration errors are recorded in the audit rather than presented as supported compiler semantics. No compiler is used by module installation, parsing, analysis or tests.

New regressions cover derive/global_allocator through true, unknown, nested and multi-name payloads; a false predicate with a definite control; child modules; bare and named test payloads; the extern-crate alias namespace control; effective macro_export/path/proc_macro_derive. Mutations restore literal-only macro-use/export tests and wrongly bind the crate alias as an attribute name.

Required checks pass: `npm ci --ignore-scripts`; full `npm test` with PYM_TLC_JAR **2,101/2,101**; formatting; Rust tests **575/575**. The passing mutation baseline and **78/78 killed mutations** include the literal-only macro-use/export readers and wrong-namespace alias. Native controls: **38 accepted / 9 expected rejections**, covering the reported cfg_attr replacement route, nested/multi-name/unknown/bare/named/child cases, false and alias controls, and path/export behavior.

Against pushed **7cff9c0b**, pinned whole Vector has **0 gains / 0 withdrawals / 0 retargets**: every one of **365,530 link facts** is unchanged (byte-identical snapshots), as are all **35,422 symbol facts**. Totals remain **67,191 resolved / 90 candidate sets / 298,249 unresolved**; **1,563 files: 1,552 clean / 11 failed**. The existing valid-Rust grammar gaps are unchanged. Namespace annotation metadata is normalized to effective guarded applications; no semantic graph fact changes. Evidence is retained under `evidence/w2-c/round14-*`; prior records are preserved.

The full production store run completes at the **default Node heap**, with no analysis/resolution errors. Every stored link and symbol equals the direct run. Graph facts remain **300,720,139 serialized bytes**; effective attribute metadata raises the analysis-return size by **218,503 bytes** to **173,550,905** (no target-list growth). Old round12 size evidence is preserved, with this run recorded separately in round14-size-capped.json.


## Round 15 — separate textual and path macro scopes

Review round 13 B1 is fixed. A bare `m!()` first uses preceding textual macro definitions in its enclosing scopes, including the ending scope of captured `#[macro_use]` modules; only if that route is absent or unproved does lookup consult path bindings. A qualified `crate::m!()`, `self::m!()` or `sub::m!()` uses only path bindings. Non-exported macro_rules definitions do not enter that table. An effective macro_export enters the **crate-root** table, regardless of the definition's lexical module, and keeps its export predicate. Explicit macro imports are path bindings; in editions 2018–2024 an unqualified import may capture an earlier textual macro. Native controls show edition 2015 rejects that non-exported `use other as m` route, so its import remains path-based. This is separate from the existing unresolved cross-crate/proc-macro call backlog, which is not expanded here.

Macro export guards are structural parse metadata (`macroExportConditions`); a symbol is public only when the export is implied by its item gates. An unknown export guard leaves its recorded visibility private and enters semantic lookup as a guarded possible binding. Source item gates and inherited module-declaration gates remain in force. Conditional export/import alternatives keep every would-be target; complementary proven alternatives may form a closed set. Structural contains edges remain source facts. Module version 15 invalidates old parses.

The native matrix checks the three reported variants, literal cfg twins, root placement of submodule exports, rejection at the submodule path, bare textual precedence, rejection of qualified non-exported paths, import ordering, macro_use modules, nested ending-scope order and inherited gates under editions 2015/2018/2021/2024 (both feature configurations where relevant). It records 39 accepted runs and 25 expected rejections. The prior 38 accepted / 9 expected-rejection compiler controls are rerun separately. Runtime and module tests still need no Rust compiler.

The effective-path regression now gives **both** files a function named `picked` and asserts which file supplies the target. Its mutation admits the ordinary layout beside an explicit path; the old different-name fixture could not detect that defect. New macro mutations admit non-exported path definitions or treat an unknown export guard as true. The retained effective-export mutation is adapted to the new guarded metadata rather than retired.

Required sequential checks pass: `npm ci --ignore-scripts`; full `npm test` with PYM_TLC_JAR **2,120/2,120**; formatting; Rust tests **594/594**. The mutation baseline passes and **81/81 final mutations are killed**. The first path-enumeration-only attempt was equivalent (ordinary files still had no admitted directory); it is preserved as a development attempt, not counted as a kill. The final mutant admits both the ordinary file and its module directory; the strengthened same-name regression fails with two targets.

Whole Vector against **caa09d2a**: **227 gains / 0 withdrawals / 0 retargets**. **Zero previously definite qualified macro facts change.** There are nevertheless **28 newly definite qualified calls**, because root-export lookup now reaches definitions in other captured files/submodules; those were previously removed by the same-file textual filter. This is more movement than the expected zero, and is retained as a direct consequence of the requested path rule. The other gains are **176 bare calls to exported macros** and **23 imports of crate-root macro exports**. All gains target 24 distinct, inspected macro_rules definitions with literal, unconditionally effective macro_export attributes. Examples include registered_event, buckets, metric_tags, cli_subcommands, and the vector-buffers assertion helpers. No cross-crate macro invocation is newly proved; eleven of the import gains are captured cross-crate root exports/reexports (the invocation backlog stays unresolved).

A further **79 unresolved imports gain would-be root-export targets**, and **285 unresolved macro links only normalize uncertainty reasons** after textual declarations stop being mistaken for path bindings; they gain no targets. These account for all **591 changed link facts**, only imports/macros. All old definite facts and all **168 invalid-code facts** are unchanged. Reach annotations move from 175,621 to **175,528** as namespace/import proof improves. Full per-link movement and rule attribution, including all 24 inspected target definitions, are retained in round15-movement.json and round15-attribution.json.

New totals: **35,422 symbols / 365,530 links; 67,418 resolved / 90 candidate sets / 298,022 unresolved**. File status remains **1,552 clean / 11 failed**, with the same documented valid-Rust grammar gaps. Production indexing/storage completes at the **default Node heap**, without analysis/resolution errors; every stored link and symbol equals the direct run. Analysis-return bytes are 173,585,779; graph-fact bytes 300,755,013. All evidence is under `evidence/w2-c/round15-*`; earlier records are preserved.


## Round 16 — failed macro-use chains are unseen textual entries

Review round 14 B1 is fixed. A captured macro_use module whose own file failed contributes an **unseen textual entry** at the end of its mod item. The same entry propagates through nested macro_use modules, whether inline or in captured files. It carries the effective macro_use predicate and enclosing module conditions, uses the same lexical scope and source ordering as visible definitions, and may supply any macro name. A bare lookup that reaches it is unresolved with failed-file-unseen-declarations and retains visible valid definitions as would-be targets. It has no failed item target or invalid-code cause. Before-mod calls are unaffected; a later present visible macro can shadow the unseen entry. **Superseded by round 17:** a failed child may contain an unreadable inner macro_use, so absence on the mod declaration does not prove absence. Every failed file module now contributes a possible unseen textual entry after its mod item. Internal parser failures remain analysis uncertainty, rather than being called invalid syntax.

The root of a textual chain needs a separate statement: if a parent file fails, its mod child declaration is absent from the captured graph. When that erased declaration was the only captured ownership route, the module cannot prove the child's ancestry or invent macros from the parent. The child call remains ordinary unresolved with no invented target or cause; a regression test pins this existing safe result. Following valid parent-file textual definitions into a child remains the separately logged lost-link limitation. No declaration recovery or directory-based ancestry guess is added. Module version 16 refreshes cached parses.

New tests pin direct and nested failed macro_use chains, an inline chain, before/after-mod ordering, a non-macro_use negative control, a later visible macro that wins, the failed-parent ancestry gap, and the three surviving mutations: latest same-scope definition, module activation only after its mod item, and conditional textual lookup retaining the path alternative. Native Rust first confirmed every supplied repro/control, including both feature configurations of the conditional case: 22 accepted runs across editions 2021 and 2024. Previous compiler matrices are rerun separately.

Required sequential foreground checks pass: `npm ci --ignore-scripts`; full `npm test` with PYM_TLC_JAR **2,130/2,130**; formatting; Rust tests **604/604**. The mutation baseline passes, and **86/86 mutations are killed**; each of the five new mutants fails its corresponding new regression (f1, f2, M1, M7, M6). There are **22 new compiler-accepted controls**, plus all **111 prior compiler controls** rerun (including their expected rejections). Long check jobs run sequentially, without competing test/Vector jobs.

Against pushed **a6ac9f28**, whole Vector is **0 gains / 0 withdrawals / 0 retargets**, with **zero changed link facts** and byte-identical link snapshots. Every symbol and captured context fact is identical too. The failed-module chain audit joins all nine captured failed-module declaration links to effective macro_use metadata: **none carries macro_use**, so no failed ending textual scope propagates through such a chain. Failed crate roots do not acquire invented module declarations. No Vector movement needs attribution.

Totals stay **35,422 symbols / 365,530 links: 67,418 resolved / 90 candidate sets / 298,022 unresolved**; **1,552 clean / 11 failed files**. All **168 invalid-code links** and **175,528 failed-file reach annotations** are unchanged, as are the documented valid-Rust grammar gaps. Serialized analysis-return size stays **173,585,779 bytes** and graph facts **300,755,013 bytes**. Portable evidence is under `evidence/w2-c/round16-*`; old evidence is preserved.

Full production storage also completes at the **default Node heap**, with no analysis/resolution errors. Every stored link and symbol equals the direct run (`round16-store.json`, `round16-equality.json`). No core changes or heap overrides.


## Round 17 — leading inner controls belong to the file module

Review round 15 B1 is fixed. Effective leading inner macro_use guards are recorded on clean file units and combined with the declaration for each body. Failed units cannot prove absence of inner macro_use, so every failed file module supplies a possible unseen textual entry after the mod item, even when its declaration has no macro_use. This supersedes the round-16 negative control and claim; the historical round-16 measurements remain the record of that head. An outer cfg(any()) still proves the mod absent and suppresses the entry. Module version 17 refreshes cached parses.

The class audit above additionally checks file-inner cfg, path, opaque/proc-macro attributes, test/bench, no_implicit_prelude, and the rest of the classification table against rustc. Its initial inner/inline path directory model was unsound; round 18 below supersedes it with unverified locations. Inner path does not reload the already selected file. File-unit opacity also applies to the source module declaration; no_implicit_prelude suppresses bare extern-prelude proof while explicit routes and local items remain available. No failed source is parsed again or recovered for metadata. Unknown inner cfg cannot create a target in a failed file because that file contributes nothing.

The audit also pins a conditional-layout interaction: two cfg_attr path alternatives can select files whose inner cfg disables the selected module in both native configurations. A guaranteed older textual macro does not prove the newer alternative applicable. An unknown module-layout applicability marker therefore prevents a closed family, retains the would-be definitions, and records macro-applicability-unverified. The native default/x controls both print 1; the regression failed as a closed two-target set before the guard.

Current main is normally merged, including the landed Go fixes. Required post-merge sequential foreground checks pass: npm ci --ignore-scripts, full npm test with PYM_TLC_JAR (**2,162/2,162**), format:check, and Rust tests (**624/624**). The new module-file suite has 20 tests. Native evidence records 30 accepted runtime cases across 2015/2018/2024, 65 attribute legality attempts, 12 additional controls (9 accepted, 3 expected rejections), and 133 prior controls.

The final mutation baseline passes and **93/93 mutations are killed**. Seven new mutations are individually pinned by the new tests: omit clean-file inner macro_use, assume failed-file absence, ignore textual-entry cfg, ignore inner path, ignore inner module opacity, ignore no_implicit_prelude, and close a textual family despite unknown applicability. Each failure log identifies its matching new regression; syntax/module loading failures do not count.

Against pushed **abd3b6f2**, whole Vector is **0 gains / 0 withdrawals / 0 retargets**. There are **36 raw link-fact changes**, all reason ordering on already unresolved bare macro links with no targets: 23 namespace-binding reasons, 9 import-cycle reasons, and 4 opaque-scope reasons. The uncertainty reason sets, source positions, state, targets, and every other field are unchanged. Each changed row follows a captured failed module declaration whose inner macro_use cannot be ruled out; round17-attribution.json records each source line and declaration. The groups are src/config/mod.rs (13), src/sources/datadog_agent/metrics.rs (4), src/sources/datadog_agent/mod.rs (18), and vdev/src/commands/release/mod.rs (1). All symbol/context facts are identical. None of the clean Vector file headers has inner macro_use, path, or no_implicit_prelude metadata; all nine failed-module declarations lack outer macro_use.

Totals remain **35,422 symbols / 365,530 links; 67,418 resolved / 90 candidate sets / 298,022 unresolved**, with **1,552 clean / 11 failed files**, **168 invalid-code links**, and **175,528 failed-file reach annotations**. The existing grammar-gap record is unchanged. Analysis-return bytes remain **173,585,779** and graph-fact bytes **300,755,013**.

The full production indexer/store completes at the **default Node heap**, with no analysis/resolution errors. Every stored link and symbol equals the final direct result, including all metadata. round17-freeze.json hashes the tested source; round17-final-checks.json records each sequential compiler/mutation/Vector/store check. Portable evidence and the concise report are under evidence/w2-c/round17-*; previous rounds remain intact. No core or grammar changes.


## Round 18 — path layouts need proof, not normalization

Review round 16 B1 is fixed conservatively. A plain outer path on a FILE module still selects the captured file and its sibling child directory. First effective path wins: a guaranteed outer path makes a later file-inner path unused, and an earlier guaranteed inline outer path excludes the later inline inner value from its metadata. Unknown earlier cfg_attr applications keep alternatives unverified. All path consumers still use effective attributes.

The newly added inner-file and inline-module directory shapes are now **unverified**, including plain values and cfg_attr payloads. We do not emulate rustc's parent-module directory tracking. Captured locations and same-filename/module-directory alternatives supply would-be file/item IDs only, never a definite link or closed set. The uncertainty propagates into nested inline/file modules and dispatch. Guessed failed files cannot become invalid-code causes or prove failed-file reach.

Exotic values (parent/current-directory components, empty components, absolute paths, backslashes) are unverified in every shape. Lexical normalization may produce an additional hint; it cannot prove rustc's selected file. This intentionally downgrades the old parent-component fixture even where its normalized path happened to agree with rustc. Vector has **zero** such values, so no material Vector cost warrants retaining an exotic special case. Symlink traversal is not inferred.

The native rustc AND cargo-run decoy matrix uses edition 2024, a u16 result returning 73, and same-named u8 decoys returning 19. Controls cover the reviewers' shapes, both winning and ignored attributes, and ordinary outer paths. The shape policy is:

| Shape | Result | Native decoy control |
| --- | --- | --- |
| Plain outer file path at crate root; sibling child | Definite | plain-outer-file |
| Provably active cfg_attr outer FILE path | Definite | plain-outer-cfg-attr |
| Outer FILE path plus later inner path | Definite; inner unused | outer-file-wins-inner |
| Two guaranteed outer FILE paths | Definite; first wins | first-outer-file-path-wins |
| Inner FILE path with crate-root parent | Unverified | inner-plain-file |
| Inner FILE path with name.rs parent; cfg_attr form | Unverified | inner-parent-name-rs; inner-cfg-attr-parent-name-rs |
| Inner FILE path with mod.rs parent or in mod.rs itself | Unverified | inner-parent-mod-rs; inner-body-mod-rs |
| Plain outer FILE path inside name.rs, mod.rs, or inline module | Definite | plain-outer-in-name-rs; plain-outer-in-mod-rs; plain-outer-in-inline |
| Inline outer/inner path in name.rs | Unverified | inline-name-rs-outer; inline-name-rs-inner |
| Inline inner path in mod.rs | Unverified | inline-in-mod-rs |
| Two nested inline modules | Unverified | inline-two-deep |
| Inline outer plus inner path | Unverified; first value retained | inline-outer-wins-inner |
| Inner redirect/.. | Unverified | sol-inner-dotdot |
| Outer a/../b.rs; ../extra/p.rs | Unverified | outer-dotdot; outer-parent-component |
| Outer ./b.rs; a//b.rs; absolute | Unverified | outer-dot; outer-empty-component; outer-absolute |
| Any remaining inner/inline nesting or its unknown predicates/unreadable values | Unverified | No definite rule claimed |
| Macro-use transfer / root export through unverified file layout | Unverified | unknown-path-textual-macro; unknown-path-exported-macro |
| Older textual fallback beside empty captured candidates | Unverified, root kept | unknown-path-empty-textual-macro |
| Backslash value | Unverified | Graph regression; no cross-platform directory rule claimed |

Unverified file locations also stay unverified through textual macro transfer and crate-root macro exports. The shared condition reader marks captured items under such a location with ?module-layout; the existing unknown-applicability rule prevents a closed macro family. A macro-use transfer also adds an unseen layout entry, since the actual file could supply macros absent from the captured candidates. A guessed failed file carries module-layout-unverified, never a claim that the failure is provably in reach. Controls cover a child textual macro, a root export, an older root fallback beside empty candidates, and a failed decoy. Structural contains edges remain source facts.

The review backlog term body.conditions in importedText is removed rather than preserved without a test. The retained entry already carries its definition/file guards, effective macro_use guards and module declaration conditions; no independent body condition is used to close the family. Module version 18 refreshes cached parses. Round-17 evidence remains the historical record; its three plain inner/inline path tests now require unverified hints.

Required sequential foreground checks pass after the normal main merge: npm ci --ignore-scripts; full npm test with PYM_TLC_JAR **2,190/2,190**; format:check; Rust tests **652/652**. The new path suite has 28 tests. All **26 native path controls pass both rustc and cargo run**, with return types and output identifying the selected target or older textual fallback. The mutation baseline passes and **99/99 mutations are killed**, including the six new path mutations; their logs identify the matching new controls.

Against pushed **b2f4b886**, the final whole-Vector result is **0 gains / 0 withdrawals / 0 retargets / 0 changed link facts**. Link snapshots are byte-identical, and every symbol/context fact is equal. Vector has **four plain outer path values**, all in the component-docs schema module (schema_core.rs, schema_enum.rs, schema_resolve.rs, schema_utils.rs), **zero values containing ..**, and **zero inner path values**. No path-related precision cost or movement needs attribution; the prior 36 accepted reason-order rows remain unchanged.

Totals remain **35,422 symbols / 365,530 links; 67,418 resolved / 90 candidate sets / 298,022 unresolved**; **1,552 clean / 11 failed files**, **168 invalid-code links**, and **175,528 failed-file reach annotations**. The existing grammar-gap record is unchanged. Analysis return remains **173,585,779 bytes**, graph facts **300,755,013 bytes**.

The final production indexer/store completes at the **default Node heap**, with no analysis/resolution errors; every stored link and symbol equals the direct run. The retained compiler controls and the 30-module-control / 65-attribute-legality matrix also pass. round18-freeze.json hashes the final tested source and fixtures, and records all sequential checks. round18-report.md and round18-attribution.json provide the handback and full-equality evidence. No core/grammar/dependency changes or heap override.
