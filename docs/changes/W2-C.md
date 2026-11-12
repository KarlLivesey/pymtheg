# W2-C: Rust language module for the code graph

This is the **no-toolchain fallback** under D16. Precise compiler-backed Rust
resolution belongs to a later chunk. Version 8 uses the installed Rust WASM
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
| Cargo context | Package/lib names, dependency renames, workspace path dependencies; explicit and automatic lib/bin/src/bin/examples/tests/benches/build.rs roots. Loose files retain structure without invented crate membership |
| Imports | Nested groups, renames, self/super/crate/absolute/raw paths; chained and cross-crate reexports; anonymous imports do not bind `_` |
| Globs | Recursive captured reexports with cycle protection and importer visibility; intact local/explicit names beat globs. A glob edge's own target remains backlog |
| Free calls, type/pattern/value paths | Definite from proved bindings; complete captured alternatives become candidates. Unknown alternatives remain unverified. Missing names stay unresolved with names retained |
| Values | Unit structs/variants and Self/path expressions extracted. Struct/named-variant literal names are constructor-capable type references. Locals/generics never acquire outer item targets |
| Pattern bindings | Structural shorthand/ref/mut/captured/tuple/slice/struct/or patterns across parameters, closures, let/else, if/while-let, match and for; binding regions mask outer functions |
| Alias/type applicability | Captured alias chains and generic/reference aliases expanded. Unsupported/cyclic/external substitutions remain unknown; unknown never means disjoint |
| Lifetimes/generics | Lifetimes ignored for impl selection. Distinct own parameters in Type<P1,...,Pn> describe a fully generic family. Explicit instantiations, specialisation and bounds still require applicability evidence |
| Associated path calls | A proved inherent name wins over traits. A sole family with omitted arguments can support name lookup before inference; explicit generic arguments cannot use that shortcut. Unknown alternative inherent impls block proof |
| Dot calls | Definite ONLY a unique proved inherent first-probe match. Everything else is unresolved-with-targets, with no closed dot-call candidate sets |
| Trait-only associated calls | Unresolved-with-targets: captured bodies/defaults are would-be targets, not proof of dispatch |
| Conditional code | One collector combines outer/inner cfg/cfg_attr, enclosing items, crate/module-file conditions and parent mod declarations. Statement/expression/binding/field/variant/arm/parameter gates are retained. Caller implication is same-crate only; no feature selection. Unknown predicates never prove a link. Complete namespace/path alternatives may be candidates; dot twins remain unverified |
| Macros/attributes | Local active macro_rules invocations link; macro_export records public visibility. Token trees are not expanded/extracted. Statement tokens and opaque block item generation can invalidate binding evidence; opaque item generation can shadow namespace fallback |
| Std/external/generated declarations | Unresolved; no compiler or filesystem fallback |

Associated const/projection lookup, qualified `<T as Trait>::f`, custom receiver
adjustment, general autoderef/unsizing, substitution/inference/bounds solving,
trait-in-scope precision and generated declarations are not implemented.
Cargo feature-enabling/dependency relationships are not inferred: cfg implication
uses captured Rust predicates, not a Cargo feature graph.
Cross-file macro exports/imports, external glob beside project glob, Copy receiver
refinement, inner/outer macro ordering, where clauses in impl identity text and a
glob import's own link remain the manager-listed backlog.

## Dispatch and unverified target representation

For `recv.name(...)`, the only definite result is an **inherent** method at the
first probe of the captured receiver: owned T with self, &T with &self, or &mut T
with &mut self. The inherent method must be visible from the caller module; private, pub(crate), pub(super) and pub(in path) restrictions are checked. Receiver lifetime/mutability forms are parsed structurally. Every
inherent alternative at that step must be proved applicable or inapplicable;
unknown bounds, cfg conditions, unresolved inherent self types, ambiguous module
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

## Failed files, causes and namespace uncertainty

The first grammar error by position yields one diagnostic with its source range
and 1-based line/column. MISSING says ``missing `token` ``; ERROR says
``unexpected `first-token` `` (one line, at most 40 token characters). Tree-sitter
does not supply expected tokens at ERROR nodes; none are invented. Diagnostic
text is deterministic and contains no absolute path.

A valid-file non-dot link is `unresolved` with `data.uncertainty: "invalid-code"`
only when lookup actually traverses a module whose own file failed, directly or
through an explicit import in a valid file. `data.cause.files` names those
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
macro_use routes (including cfg_attr); no per-method derive knowledge
remains. The inert attribute whitelist is shared from parse.ts:
allow/warn/deny/forbid/expect, cfg/cfg_attr, repr/doc/deprecated/must_use/
non_exhaustive, inline/cold/track_caller, no_mangle/export_name/link_section/used,
automatically_derived, test/ignore/should_panic, path, macro_export/macro_use,
link, no_std/no_implicit_prelude. Unknown attributes are opaque.

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

## Round 7 review response (current head)

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
