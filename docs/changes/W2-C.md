# W2-C: Rust language module for the code graph

This is the **no-toolchain fallback** under D16. Precise compiler-backed Rust
resolution belongs to a later chunk. Version 6 uses the installed Rust WASM
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
| Conditional code | All captured branches retained; no feature selection. Complete namespace/path alternatives may be candidates. Dot cfg twins remain unverified, including bounded alternatives |
| Macros/attributes | Local active macro_rules invocations link; macro_export records public visibility. Token trees are not expanded/extracted. Statement tokens and opaque block item generation can invalidate binding evidence; opaque item generation can shadow namespace fallback |
| Std/external/generated declarations | Unresolved; no compiler or filesystem fallback |

Associated const/projection lookup, qualified `<T as Trait>::f`, custom receiver
adjustment, general autoderef/unsizing, substitution/inference/bounds solving,
trait-in-scope precision and generated declarations are not implemented.
Cross-file macro exports/imports, external glob beside project glob, Copy receiver
refinement, inner/outer macro ordering, where clauses in impl identity text and a
glob import's own link remain the manager-listed backlog.

## Dispatch and unverified target representation

For `recv.name(...)`, the only definite result is an **inherent** method at the
first probe of the captured receiver: owned T with self, &T with &self, or &mut T
with &mut self. Receiver lifetime/mutability forms are parsed structurally. Every
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
when its path traverses a failed module file, or an absent name's lookup scope
has failed files that could have declared it. `data.cause.files` names those
project-relative files, sorted. It has **no target, candidates or data.targets**;
the files are causes, never targets or named recovered items. A missing name in
a scope with no failed files is ordinary unresolved. Fixing and re-indexing
clears failure causes and resolves newly readable declarations.

A failed file also means unseen declarations may exist. Its owning module's
fallback lookup through a glob or an enclosing scope cannot prove an unshadowed
name; intact direct declarations and explicit imports in valid files remain
authoritative. Unseen impls can reach the failed crate's types/dependencies and
callers through manifest dependency reachability. If captured manifests cannot
prove the dependency graph (workspace inheritance/patches/missing path context),
all failed workspace files count conservatively. Dot calls never become
invalid-code: they retain **only valid** would-be targets and a
`failed-file-unseen-declarations` annotation. This annotation cannot undo a
proved first-step inherent match.

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
unverified dot calls. Syntax diagnostics use the interface's message/range.

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

Whole-file failure removes **485 symbols / 6,726 source links**. There are **267 targetless invalid-code links** with sorted failed-file causes. **104,099 links carry failed-file-unseen-declarations uncertainty**; 6,794 withdrawals carry that annotation, often alongside D16/type/applicability uncertainty. This is an annotation count, not a claim that file failure alone caused every one. The integrity audit checks all IDs, failure causes and absence of closed dot sets.

## Original 152 and fresh audit

**16 restored; 0 identified wrong-before; 136 unverified under the final fallback policy; 0 correct-and-provable under that policy still lost.** Of those 136, 123 retain the original hint and 13 have count-only overflow. Every row records its rule. Reviewer-highlighted #64, #65, #67 and #68 are restored. This is a changed D16 precision contract, not a claim that Rust itself cannot prove the 136 calls.

Fresh seeded source hand check: **30 definite / 30 newly downgraded / 15 unresolved**. No wrong definite link. Of the 30 downgraded calls, 26 retain the expected body and 4 omit the complete list by overflow; all four expected bodies are verified in the uncapped inventory. No unexpected missing hint. Individual judgments are in d16-samples.json.

## Observations and checks

Real indexer/store elapsed: 373.5 s; module parse 82.9 s, analysis 47.1 s, resolve 42.1 s. Node v24.21.0, execArgv `[]`, NODE_OPTIONS empty, default heap limit 4,496,293,888 bytes. Peak RSS 6,756,996 KiB. Timings/memory are observations on a loaded machine. All 365,514 links match direct module output including metadata.

Valid Cargo roots observed: 35 libraries, 11 binaries, 3 examples, 17 tests, 14 benches, 10 build scripts. src/bin, examples, tests, benches and build.rs are crate roots under Cargo target discovery, not forced loose files. Failed targets contribute no unit symbols.

Final sequential checks: npm ci --ignore-scripts; PYM_TLC_JAR=the supplied jar npm test (**1,389 pass, 0 skipped**); format:check; Rust tests (**143 pass**). All exit 0. **36 mutations killed**, including overflow; 71 native compiler cases plus the smaller namespace/binding/file controls pass. Runtime/tests never need rustc/Cargo.

Symbols by kind: `{"const": 1287, "enum": 704, "function": 9158, "impl": 4502, "macro": 59, "method": 9191, "module": 3659, "static": 144, "struct": 2747, "trait": 155, "type": 1197, "variant": 2619}`.

Links by kind: `{"calls": 134752, "contains": 33870, "implements": 2999, "imports": 28988, "macros": 24869, "modules": 1468, "patterns": 10937, "types": 73393, "values": 54238}`.

Top unresolved: `[["Some", 7810], ["assert_eq", 7414], ["String", 4464], ["None", 4407], ["Option", 4311], ["assert", 3904], ["Ok", 3815], ["Vec", 3118], ["vec", 2431], ["Result", 2209]]`.
