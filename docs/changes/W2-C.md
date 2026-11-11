# W2-C: Rust language module for the code graph

Round-four review revision, module version 4. Current main was merged normally,
including the schema-3 graph core and blank-line identity conformance kit. W2-C
changes only its Rust folder, Rust tests/fixtures, evidence and this note. No
Cargo/rustc, Rust installation or project execution is required by the module or
tests. The module uses only supplied snapshots and never reads project files. The installed Rust WASM grammar and tags query
load through the shared Tree-sitter helper; duplicate function/method tags are
filtered. Parser trees never escape parsing.

## Constructs and limits

| Construct | Result |
|---|---|
| Crate/file/module units, functions, structs, enums/variants, traits/methods/default bodies, impls, aliases, const/static and macro_rules | Symbols with exact UTF-16 spans and contains links; private declarations are ordinary symbols |
| Type, value and macro namespaces | Separate lookup; named-field structs cannot capture value calls; constructor form is data |
| `_` inference/pattern placeholders | Not emitted as named references; `use … as _` keeps the import relationship but binds no lookup name |
| File/inline/function-local modules, name.rs, name/mod.rs and literal path attributes | Module places and scope barriers; children of path-loaded files are beside that file |
| Cargo libraries, explicit targets, automatic src/bin, examples, tests, benches and build.rs | Proper crate roots respecting auto-target flags; build dependencies are separate; no target is executed |
| Workspace paths, dependency aliases and library names | Captured path crates resolve across files; target library name wins unless Cargo explicitly renames the dependency; hyphens/raw identifiers normalize |
| Nested/renamed imports, self/super/crate/absolute paths, multi-hop and cross-crate reexports | Import and use sites use the same recursive lookup in the owning crate; direct dependency-crate reexports (`pub use dep;`) reach the Cargo dependency instead of recursing into their own binding |
| Glob member lookup, including chained glob reexports | Follow captured contents with cycle protection; check pub/pub(crate)/pub(super)/pub(in path)/private visibility for the importing module. Explicit imports and local items shadow globs |
| Glob edge itself | Unresolved; assigning that edge a module target remains backlog |
| Simultaneous type/value/macro imports | Import edge unresolved if one-of cannot express simultaneous bindings; each use selects its namespace |
| Free calls and applicable inherent associated calls | Definite when facts determine one target; complete competing choices become candidates. Explicitly captured alias-associated functions remain usable; simple alias receiver types expand; unsupported substitutions remain unresolved |
| Receiver self, mut self, borrowed/lifetime-borrowed self and typed Self/&Self/&mut Self | Parsed structurally; preserve borrow and mutability, reject inapplicable methods |
| Box/Rc/Pin and other custom typed self | Receiver syntax/type retained; dispatch unresolved when custom receiver adjustment is needed. No arbitrary Deref/Pin projection |
| Lifetime-only impls | Lifetimes ignored for applicability; they never select between impls |
| Self variants and members of the same inherent generic impl | Nominal Self lookup ignores arguments; same physical impl membership proves generic applicability. Methods are indexed by contains source IDs, so equal impl identity text cannot merge ownership |
| Other generic/const substitution, inference and bounds | Unresolved when not established; concrete arguments are compared using syntax shapes and their declaration/annotation namespace bindings. Equal spelling in different scopes is not proof; aliases remain unknown rather than excluding a true candidate |
| Blanket trait impls for T/&T/&mut T | Their applicable method names make receiver choices uncertain; include project default methods. Unknown traits/defaults prevent incomplete candidate sets |
| Generic wrapper impls | Affect compatible nominal receiver types; a distinct explicit nominal type proves incompatibility. Unsatisfied/unknown bounds are not guessed |
| Instance versus associated functions | A static trait function cannot mask a dot call. Associated lookup also checks missing blanket alternatives, unless an applicable inherent function wins |
| Reference impls | Only supplied names are uncertain for known traits. An uncaptured trait's unknown names make all dot calls on that type uncertain; inherent Type::method paths remain independent |
| Dispatch evidence across crates | Restricted to the caller's crate and reachable captured path dependencies; unrelated workspace crates do not suppress calls |
| Trait-only calls | One captured impl alone does not prove dispatch. Multiple complete known targets become candidates, including default bodies; unknown alternatives remain unresolved |
| Standard trait applicability | A small method-name catalogue constrains Drop, Default, Clone, From/TryFrom/Into/TryInto, FromIterator/IntoIterator, Add/AddAssign and Debug/Display. It creates no external targets. Captured local traits, nonstandard imports, opaque glob shadowing, and captured Cargo/extern-crate aliases prevent standard-namespace assumptions |
| Conditional arguments and parameters | Attributes/comments are not arguments; minimum/maximum arity accounts for cfg-conditional syntax |
| if let, while let, let-else and match patterns | Bind only in the consequent/body, after the completed let-else declaration, or within the corresponding match arm. Else/value expressions do not inherit those bindings |
| Type and pattern references | Namespace-correct types/implements/patterns links; qualified patterns resolve variants, constructors and consts |
| macro_rules and macro_export | Definitions and local active invocations captured; macro_export visibility is pub (crate-root public), while containment records the definition site |
| Macro token trees, generated types/declarations, proc macros/derives | Not expanded or extracted; module declarations inside cfg_if!/include! are not used to invent module membership |
| Standard/registry/uncaptured dependencies | Unresolved with their names kept |

Both cfg branches remain captured; there is no feature/platform selection. Partial
syntax remains partial with diagnostics (not a clean parse). A malformed grammar
load remains a failure. Explicit non-glob paths are structural relationships, not
a general Rust visibility/type-checking proof. General trait-in-scope selection,
supertrait/bounds solving, associated-type projection, complex alias substitution,
closure/result/chained-receiver inference and arbitrary macro scope/export lookup
are not implemented. Custom typed receivers are recorded without guessing their
adjustment. Files outside captured Cargo/module trees retain symbols and
containment; nested support files are not invented as automatic Cargo targets.

The TOML reader handles literal captured package/workspace/target/path-dependency
context, not Cargo evaluation, generated targets or automatic workspace inference.
No compiler or filesystem fallback fills missing evidence.

## Identity and interface

IDs combine project/module/file, kind, scoped identity and duplicate ordinal;
positions are not part of identity. Impl identities retain trait/self/generic
syntax. Where clauses remain omitted from the identity text (backlog); duplicate
ordinals distinguish blocks. Ownership uses contains source IDs, independent of
that text. Raw identifiers normalize names while spans cover original spelling.
Anonymous blocks use structural ordinals. The unchanged exact-position fixture
also passes the stricter independent blank-line reindex with unchanged IDs and
no exclusions.

The interface cannot represent simultaneous import bindings as one-of targets,
as a closed resolution, or a finite closed candidate list plus an unknown
alternative. Such edges remain unresolved with known targets and the reason in
link data. No core/interface change was made.

## Resolution work

Imports, places, declarations and members are indexed once; binding evidence is
cached per function and queried through lexical scopes. Completed lookups are
memoized with module-view keys and recursion guards. Receiver selection copies
lookup results so one uncertain alias cannot mutate later cached lookups. Reachable Cargo roots and
dispatch guards are cached. There is no project-wide import/place scan per name
or repeated scan of a function body. Work still depends on path depth, candidate
memberships and dependency/reexport relationships. Timing is not an assertion.

The round-two corrected scan-based performance baseline and full-output equality
records are preserved as history. Round three intentionally changes semantics;
those old equality hashes are not claimed to prove the new semantics unchanged.
The final full-store report and new movement/audit records below are authoritative.

## Round-four safety and restored relationships

| Review item | Behavior |
|---|---|
| R1: structural pattern bindings | Shorthand fields, ref/mut/ref-mut, captured, nested tuple/slice/struct/tuple-struct/or patterns mask free calls. Function/closure parameters, let/let-else, if/while-let, match and for use their actual regions; the iterator expression does not inherit the for binding; parameter value bindings also mask calls in signature expressions (confirmed with rustc) |
| R2: aliases | Expand captured identity/generic aliases, chains and references before impl/receiver decisions. Parenthesized types remain transparent. Known tuple/array and unshadowed prelude/std Box outer constructors cannot become a universal blanket for unrelated nominal types. Unknown, cyclic, external or unsupported expansion remains uncertainty. Substituted names that would change namespace are not guessed |
| R3: std/core alternatives | The method-name guard table is exactly `from`, `into`, `try_from`, `try_into`, `borrow`, `borrow_mut`, `to_owned`, `to_string`, `type_id`, `as_ref`, `as_mut`, `clone`, `clone_from`, `into_iter`, `default`. It covers the requested From/Into/TryFrom/TryInto, Borrow/BorrowMut, ToOwned, ToString/Display, Any, reference AsRef/AsMut/Clone, Iterator/IntoIterator and Default alternatives. It conservatively withholds dot dispatch for these names without attempting trait/result inference. An independently proven inherent PATH call remains definite. Names outside this table are assumed not universally supplied by uncaptured standard-library blankets |
| R4: statement macros | A local identifier token in an opaque statement macro invalidates its previous binding evidence until a new binding establishes it. The guard follows block activation order, including self; it does not expand or inspect macro definition bodies |
| R4: item macros | Literal type-name tokens in opaque item/statement macro invocations make dot dispatch on that type uncertain. Qualified paths and local shadowing cannot evade the guard; every reachable same-named nominal is retained conservatively, plus expanded alias targets. Proven inherent path calls remain independent |
| R5: fully generic inherent impls | Distinct own parameters in exactly `Type<P1,...,Pn>`, ignoring lifetimes, apply to every instantiation. Unbounded impls apply outright; bounds permit path name lookup but do not prove dot applicability. Same physical impl membership remains proof. Expanding an alias to a specialised type never makes that impl universal |
| R5: receiver probing | Proven exact owned/shared inherent receivers precede nominal-wrapper trait adjustments. Universal/project reference guards and the std table remain conservative. Mutable/custom receiver adjustment is not broadened |
| R6: loss audit | All original 152 links are reclassified individually, including restored entries. The previous assertion that all 63 remaining links were unprovable was inaccurate |
| R7: expression values | Bare unit-struct and enum-variant expressions, including Self paths, emit value-namespace links. Named-field variant imports and patterns remain valid independently of bare-value lookup. Locals/self stay unresolved; a named-field variant is not a bare value constructor |
| Syntax-error safety | Recovered declarations inside ERROR nodes, or declarations with broken headers, carry unsafe structure. Broken struct/enum field lists taint the declaration. Unsafe impls do not enter the method index; malformed use structure makes lookup uncertain. Such symbols cannot support a definite link or closed set from any file, including containment links. Recovered method headers remain possible before arity/receiver filtering. Clean headers elsewhere in a partial file remain usable |

All candidate sets presented by the resolver are **closed**. If lookup or dispatch
is not proven complete, the link remains unresolved. Analyze retains known project
symbol IDs in `data.targets` and explains uncertainty in `data.uncertainty`; these
are evidence, not a one-of resolution. A singleton possible trait implementation
also remains unresolved. No OPEN sets are emitted. Analyze rebuilds this metadata
from captured facts each run; it neither reparses nor reads project files. It uses
one indexed resolver pass to annotate evidence, followed by the core's ordinary
resolution pass. Both costs are reported separately.

The macro guards are deliberately limited to literal invocation tokens and their
statement/item positions. They cannot detect an expansion inventing a type/name
absent from the invocation. Macro/proc-macro/derive bodies are not expanded.
Cross-file macro exports/imports, the mixed external/project-glob case and all
other manager-listed backlog remain outside this revision. General substitution,
trait-in-scope precision, argument/result inference, supertraits, arbitrary Deref,
Box/Pin/Rc receiver projection, and generated declarations are not implemented.
Known Box/tuple outer shapes do not add a standard-library target to the graph.

## Vector and loss accounting

| Observation | Round-three head `3b19541f` | Round-four release |
|---|---:|---:|
| Claimed / clean / partial / failed | 1,563 / 1,552 / 11 / 0 | 1,563 / 1,552 / 11 / 0 |
| Symbols | 35,907 | 35,907 |
| Links | 310,195 | 365,699 |
| Resolved | 109,632 | 115,794 |
| Closed candidate sets | 1,230 | 1,102 |
| Unresolved | 199,333 | 248,803 |

The release real-store run observed 144.130 s total wall time, including 38.014 s
module parsing, 7.603 s analysis/evidence annotation and 8.082 s resolution.
The independent direct-module run observed 53.870 s total (36.348 s parsing,
7.534 s analysis, 6.487 s resolution). These are loaded-machine observations,
not thresholds. The previous submitted real-store observation was 189.492 s
total, 60.790 s parsing and 8.999 s resolution; it had no evidence-annotation
resolver pass. These different loaded-machine runs are not a speed claim.
`round4-release-store.json` and `round4-release-summary.json`
record kinds, top unresolved names, parse states and timings. Full per-link
comparison proves the direct module and real store agree on all 365,699 links'
file, span, kind, name, state, target IDs and data; counts alone were not used.

All 1,563 Rust files at Vector
`515e87d9861b564f521a8992d224892cd8cae120` are indexed through the real indexer
and fresh schema-3 SQLite store, not a subset. The 11 partial files remain grammar
partials; zero files fail, with no analysis/resolution errors. There are 92 Cargo
target roots (36 lib, 11 bin, 3 example, 18 test, 14 bench, 10 build). Sources and
stores stay in unique scratch and are deleted after use. No Vector program is run.

`round4-release-movement-summary.json` compares every edge against the previous
review head. There are 55,504 newly extracted value links: 6,867 resolved, 16
candidates and 48,621 unresolved. Existing links gain 502 definite calls (498
reach fully generic impls: 436 paths, 12 self dot calls and 50 other dot calls).
Safety rules withhold 1,207 previous definite links and 144 previous candidate
sets; no definite link retargets. All 141 sets added in round three are now
unresolved: 136 from/try_from conversion sets have unknown std alternatives,
and five validate/batcher sets lack generic applicability proof. Three other
emit sets lose binding evidence after opaque statement macros. The remaining
1,086 old candidate sets stay candidates; 16 new value sets give 1,102 total.
The larger unresolved count also includes ordinary local expression values
whose declarations/types are deliberately not inferred.

`round4-loss-classification.{json,md}` enumerates **all original 152** against
round-one `d60ac141` on the same 131 files: **101 restored, 51 remain**. Of the
remaining links, (a) wrong before = **0**, (b) unprovable under an individually
named current rule = **51**, (c) correct/provable still lost = **0**. The previous
round's claim that all 63 were unprovable was inaccurate: this revision restores
12 more, including with_increment and Generational::new examples. Remaining
reasons cover substitution/inference, simultaneous/import namespace completeness,
required macro guards, unknown earlier receiver steps, custom receivers and
project blankets. Their old targets are not claimed wrong. Another 129 newly
withheld links on those two crates are listed separately in
`round4-additional-withheld.json`; they are not hidden in the original cohort.

The new seed 0x20261114 selects 30 resolved, every endpoint in 15 candidate sets,
15 general unresolved and 20 unresolved self calls with captured in-project
members. The 20-entry pool is explicit and deduplicated by target ID, not mere
coincidental names. Sources and all candidate endpoints are inspected; judgments
are retained in `round4-audit.md` and the hand-check JSON. Findings fixed during
this audit include aliases to known Box/tuple shapes poisoning unrelated receivers,
parenthesized identity aliases, exact generic receiver applicability, self value
expressions and qualified/shadowed macro type tokens. Sampling is not a universal
accuracy claim.

## Validation and history

The final isolated sequence passed: `npm ci --ignore-scripts`; `npm test`
with the requested `PYM_TLC_JAR` (**1,343/1,343**, zero failed/cancelled/skipped);
`npm run format:check`; and `node --test test/graph-rust*.test.mjs`
(**97/97**, zero failed/cancelled/skipped). The frozen source hashes were unchanged
through all four commands. `round4-validation.json` and `round4-check-*.log`
record the commands and results. All **30** scratch rustc oracle cases pass.

Four scratch-only compiled-module mutations disable R1 shorthand binding, R2 alias
expansion, R3 std blanket guards and R5 universal generic applicability. The unchanged
baseline passes and every mutation fails an assertion. The oracle harness invokes
installed rustc only in disposable scratch, records actual compile/run outcomes,
and is never imported by the language module or tests. Runtime and tests need no
Rust toolchain. All numbered review items have regressions; exact fixture spans and
independent blank-line identity conformance remain enforced without exclusions.

Failed and superseded development attempts remain in `evidence/w2-c/`; the round-four
README identifies the authoritative final records. No cancelled, failed, overlapping
or obsolete run is counted as final validation. Earlier versions of this change note
and prior evidence remain in git/history; old equality hashes do not prove this
intentional semantic revision unchanged.

Post-reboot verification: fetching and normally merging `origin/main` reported
already up to date at `326fdfe3`. The Rust implementation and test hashes match
`2507ca5f` and the completed round-four Vector/audit/mutation evidence. No further
semantic change was needed, and no new post-reboot Vector run is claimed. All four
required commands were rerun sequentially: install and format pass, 1,343 full-suite
tests and 97 focused Rust tests pass, zero failed/cancelled/skipped.
`round4-reboot-validation.json` records the recovered artifact hashes, source-hash
equality and new check logs without overwriting the original evidence.
