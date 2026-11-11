# W2-C: Rust language module for the code graph

Round-three review revision, module version 3. Current main was merged normally,
including the schema-3 graph core and blank-line identity conformance kit. W2-C
changes only its Rust folder, Rust tests/fixtures, evidence and this note. No
Cargo/rustc, Rust installation, project execution or project filesystem reads are
required by the module or tests. The installed Rust WASM grammar and tags query
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
| Free calls and applicable inherent associated calls | Definite when facts determine one target; complete competing choices become candidates. Explicitly captured alias-associated functions remain usable; alias dot dispatch stays unresolved without expanding the underlying method set |
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
supertrait/bounds solving, associated-type projection, type-alias expansion,
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
or a finite candidate list plus an unknown alternative. Such edges remain
unresolved. No core/interface workaround was made.

## Resolution work

Imports, places, declarations and members are indexed once; binding evidence is
cached per function and queried through lexical scopes. Completed lookups are
memoized with module-view keys and recursion guards. Reachable Cargo roots and
dispatch guards are cached. There is no project-wide import/place scan per name
or repeated scan of a function body. Work still depends on path depth, candidate
memberships and dependency/reexport relationships. Timing is not an assertion.

The round-two corrected scan-based performance baseline and full-output equality
records are preserved as history. Round three intentionally changes semantics;
those old equality hashes are not claimed to prove the new semantics unchanged.
The final full-store report and new movement/audit records below are authoritative.

## Vector and loss accounting

All 1,563 `.rs` files at Vector
`515e87d9861b564f521a8992d224892cd8cae120` were indexed through the real indexer
and a fresh schema-3 SQLite store. Sources stayed in unique scratch. Both runs
have 1,552 clean, 11 partial, zero failed files and zero analysis/resolution errors.
The partial paths/grammar diagnostics remain recorded; no partial result was
relabeled clean. No Vector code was executed.

| Whole repository | Symbols | Links | Resolved | Candidate sets | Unresolved |
|---|---:|---:|---:|---:|---:|
| Round two, b3a0147d | 35,907 | 311,132 | 106,602 | 1,090 | 203,440 |
| Round three | 35,907 | 310,195 | 109,632 | 1,230 | 199,333 |

937 placeholder edges disappeared: **72 wrong definite `_` links, one wrong
candidate set and 864 already unresolved placeholders**. There are 3,790 old
unresolved → resolved transitions (1,247 calls, 981 imports, 1,120 types, 427 patterns,
15 implements) and 141 unresolved → candidate transitions. There are also 688
old definite → unresolved transitions (394 calls, 230 imports, 60 types, four
patterns), retained explicitly in the full movement ledger rather than hidden
by the net gain. Visibility, receiver/blanket applicability and missing alternatives
now constrain those decisions. No definite edge retargeted to a different symbol.
The full transition ledger is `round3-submission-movement-{summary,links}.json`.

The earlier write-up's blanket justification of 152 withheld links was inaccurate.
On the same original 131-file/two-crate scope, **89 correct, provable links are
restored; 63 remain**. Every remaining link is listed in
`round3-loss-classification.{md,json}` with its old target and required evidence:

| Category | Count |
|---|---:|
| (a) Was wrong before | 0 |
| (b) Not provable under the stated supported rules | 63 |
| (c) Correct and provable, still lost | 0 |

The 63 are: 11 cross-impl generic/inference cases, 14 simultaneous namespace
imports, 17 uncaptured trait-default/scope cases, one uncaptured reference-trait
case, 13 generic-trait applicability cases and seven custom self/Pin cases.
These are not claimed to have been wrong Rust targets before. No new withheld
round-one link lies outside the previous 152-link set. The two-crate totals are
27,194 links: 10,877 resolved / 31 candidate sets / 16,286 unresolved.

The new seed samples 30 resolved, all endpoints of 15 candidate sets, 15 general
unresolved and 20 unresolved self calls with captured in-project inherent members.
All final judgments are recorded in `round3-audit.md` and
`round3-submission-audit.json`. The targeted audit found and fixed conditional-arity,
physical impl ownership and static-versus-instance blanket mistakes; it did not
merely list ordinary supported losses. Remaining targeted cases require custom
receiver projection, cross-impl substitution, unknown trait defaults or generated
nominal/module declarations. Sampling is not a universal accuracy proof.

The final module run observed 40.921 s parse, 5.132 s resolve and 52.911 s
module wall time. The separate fresh real-store run is recorded in
`round3-submission-store.json`: 60.790 s module parse, 8.999 s resolve and
189.492 s total through scratch copy/index/statistics, before cleanup. Timings
are observations; the store counts exactly match the module output. There are 92 Cargo
roots: 36 lib, 11 bin, three example, 18 test, 14 bench and ten build targets.
Exact per-kind counts and top unresolved names are retained in that report.
The final audit also exposed and fixed dependency-crate reexports and an overly
broad alias guard; those fixes restore ordinary paths instead of merely listing
lost patterns. Argument matching retains lifetime-free AST shapes, character
const literals and scoped binding evidence; it does not expand type aliases.

## Validation and history

Regressions cover each numbered review item with positive, negative and relevant
ambiguous controls, plus the further ordinary patterns found in the targeted audit.
The existing trait-dispatch negative and candidate checks remain intact.
All four required commands passed sequentially: install, TLC-enabled full suite
(1,324/1,324; zero skipped/cancelled), formatting, and focused Rust tests (78/78).
Final required checks and source hashes are recorded in `round3-validation.json`.
The final four-command sequence uses the manager-specified TLC jar, alone and in
order. Earlier development validation overlapped subsequent edits/builds; it is
explicitly not accepted as final evidence. Cancelled/aborted/superseded experiments
remain in evidence, including the failed two-full-parse WASM comparison and the
cancelled obsolete development store. None is counted as a passed property.
